import Foundation
import GuardianXPC

private let daemonStateURL = URL(
  fileURLWithPath: "/Library/Application Support/FionnbarHomework/Privileged/guardian-daemon-state.json"
)

private final class GuardianStateStore {
  private let lock = NSLock()
  private let url: URL
  private var state: GuardianDaemonState

  init(url: URL) throws {
    self.url = url
    if FileManager.default.fileExists(atPath: url.path) {
      let data = try Data(contentsOf: url)
      state = try GuardianWireCodec.decode(GuardianDaemonState.self, from: data)
    } else {
      state = GuardianDaemonState()
    }
  }

  func status() -> GuardianDaemonStatus {
    lock.lock()
    defer { lock.unlock() }
    return state.status
  }

  func apply(_ request: GuardianSetHomeworkModeRequest) throws -> GuardianDaemonStatus {
    lock.lock()
    defer { lock.unlock() }
    var nextState = state
    let status = try nextState.apply(request)
    try persist(nextState)
    state = nextState
    return status
  }

  private func persist(_ state: GuardianDaemonState) throws {
    let directory = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700, .ownerAccountID: 0, .groupOwnerAccountID: 0],
      ofItemAtPath: directory.path
    )
    let data = try GuardianWireCodec.encode(state)
    try data.write(to: url, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
}

private final class GuardianDaemonService: NSObject, GuardianDaemonXPCProtocol {
  private let store: GuardianStateStore

  init(store: GuardianStateStore) {
    self.store = store
  }

  func fetchStatus(withReply reply: @escaping (Data) -> Void) {
    reply(encoded(GuardianXPCReply.accepted(status: store.status(), message: "Guardian daemon is available.")))
  }

  func setHomeworkMode(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  ) {
    do {
      guard encodedRequest.count <= 4_096 else {
        reply(encoded(GuardianXPCReply.rejected(
          .invalidRequest,
          message: "The privileged request exceeds the 4096-byte limit."
        )))
        return
      }
      let request = try GuardianWireCodec.decode(
        GuardianSetHomeworkModeRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)

      // This check stays adjacent to the privileged state change. The daemon
      // never displays authorization UI and never caches external references.
      try GuardianAuthorization.validateAdministratorExternalForm(authorizationExternalForm)
      let status = try store.apply(request)
      let action = request.enabled ? "enabled" : "disabled"
      reply(encoded(GuardianXPCReply.accepted(
        status: status,
        message: "Homework mode \(action); audit reason recorded."
      )))
    } catch let error as GuardianRequestValidationError {
      let code: GuardianXPCErrorCode
      switch error {
      case .duplicateRequest: code = .duplicateRequest
      case .staleRequest, .requestFromFuture: code = .staleRequest
      case .unsupportedProtocol: code = .unsupportedProtocol
      case .invalidAuditReason: code = .invalidRequest
      }
      reply(encoded(GuardianXPCReply.rejected(code, message: error.localizedDescription)))
    } catch let error as GuardianAuthorizationError {
      reply(encoded(GuardianXPCReply.rejected(.authorizationDenied, message: error.localizedDescription)))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  private func encoded(_ response: GuardianXPCReply) -> Data {
    (try? GuardianWireCodec.encode(response)) ?? Data()
  }
}

private final class GuardianListenerDelegate: NSObject, NSXPCListenerDelegate {
  private let service: GuardianDaemonService

  init(service: GuardianDaemonService) {
    self.service = service
  }

  func listener(
    _ listener: NSXPCListener,
    shouldAcceptNewConnection newConnection: NSXPCConnection
  ) -> Bool {
    newConnection.exportedInterface = NSXPCInterface(with: GuardianDaemonXPCProtocol.self)
    newConnection.exportedObject = service
    newConnection.activate()
    return true
  }
}

@main
private struct GuardianDaemonApplication {
  static func main() {
    do {
      let identity = try GuardianCurrentCodeSignature.identity()
      guard identity.bundleIdentifier == GuardianConstants.daemonBundleIdentifier else {
        throw DaemonError.incorrectCodeIdentity(identity.bundleIdentifier)
      }
      let requirement = try GuardianSigningRequirement.make(
        teamIdentifier: identity.teamIdentifier,
        allowedBundleIdentifiers: [
          GuardianConstants.parentBundleIdentifier,
          GuardianConstants.agentBundleIdentifier,
        ]
      )
      let store = try GuardianStateStore(url: daemonStateURL)
      let service = GuardianDaemonService(store: store)
      let delegate = GuardianListenerDelegate(service: service)
      let listener = NSXPCListener(machServiceName: GuardianConstants.daemonMachService)
      listener.setConnectionCodeSigningRequirement(requirement)
      listener.delegate = delegate
      listener.activate()
      withExtendedLifetime((listener, delegate, service, store)) {
        RunLoop.current.run()
      }
    } catch {
      fputs("guardian-daemon: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}

private enum DaemonError: Error, LocalizedError {
  case incorrectCodeIdentity(String)

  var errorDescription: String? {
    switch self {
    case .incorrectCodeIdentity(let identifier):
      "The guardian daemon has the wrong signing identifier: \(identifier)."
    }
  }
}
