import Foundation
import GuardianXPC
import Security

private let daemonStateURL = URL(
  fileURLWithPath: "/Library/Application Support/FionnbarHomework/Privileged/guardian-daemon-state.json"
)
private let lifecycleKeyURL = URL(fileURLWithPath: GuardianConstants.lifecycleKeyPath)

private final class GuardianStateStore {
  private let lock = NSLock()
  private let url: URL
  private var state: GuardianDaemonState

  init(url: URL) throws {
    self.url = url
    let loadedState: GuardianDaemonState
    if FileManager.default.fileExists(atPath: url.path) {
      let data = try Data(contentsOf: url)
      loadedState = try GuardianWireCodec.decode(GuardianDaemonState.self, from: data)
    } else {
      loadedState = GuardianDaemonState()
    }
    try GuardianRequestValidator.validatePolicy(loadedState.policy)
    state = loadedState
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

  func beginChildSession(
    _ request: GuardianBeginChildSessionRequest,
    guardianSessionID: UUID,
    completionCapability: String
  ) throws -> (grant: GuardianChildSessionGrant, status: GuardianDaemonStatus) {
    lock.lock()
    defer { lock.unlock() }
    var nextState = state
    let grant = try nextState.beginChildSession(
      request,
      guardianSessionID: guardianSessionID,
      completionCapability: completionCapability
    )
    try persist(nextState)
    state = nextState
    return (grant, nextState.status)
  }

  func completeChildSession(
    _ request: GuardianCompleteChildSessionRequest
  ) throws -> GuardianDaemonStatus {
    lock.lock()
    defer { lock.unlock() }
    var nextState = state
    let status = try nextState.completeChildSession(request)
    try persist(nextState)
    state = nextState
    return status
  }

  func apply(_ request: GuardianReplacePolicyRequest) throws -> GuardianDaemonStatus {
    lock.lock()
    defer { lock.unlock() }
    var nextState = state
    let status = try nextState.apply(request)
    try persist(nextState)
    state = nextState
    return status
  }

  func evaluate(
    _ request: GuardianApplicationEvaluationRequest
  ) throws -> (decision: GuardianApplicationDecision, status: GuardianDaemonStatus) {
    lock.lock()
    defer { lock.unlock() }
    return (try state.evaluate(request), state.status)
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
  private let lifecycleKey: Data

  init(store: GuardianStateStore, lifecycleKey: Data) {
    self.store = store
    self.lifecycleKey = lifecycleKey
  }

  func fetchStatus(withReply reply: @escaping (Data) -> Void) {
    reply(encoded(GuardianXPCReply.accepted(status: store.status(), message: "Guardian daemon is available.")))
  }

  func evaluateApplication(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianApplicationEvaluationRequest.self,
        from: encodedRequest
      )
      let result = try store.evaluate(request)
      reply(encoded(GuardianXPCReply.evaluated(status: result.status, decision: result.decision)))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(.invalidRequest, message: "The application evaluation is malformed.")))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func beginChildSession(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianBeginChildSessionRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)
      let assertion = try GuardianLifecycleAuthenticator.authenticate(
        assertion: request.lifecycleAssertion,
        authenticationTag: request.lifecycleAuthenticationTag,
        key: lifecycleKey
      )
      guard assertion.mode == .homework || assertion.mode == .free,
            assertion.serviceSessionId == request.serviceSessionID,
            assertion.weekId == request.weekID,
            assertion.day == request.day else {
        throw GuardianLifecycleAuthenticationError.invalidAssertion
      }
      let result = try store.beginChildSession(
        request,
        guardianSessionID: UUID(),
        completionCapability: try makeCompletionCapability()
      )
      reply(encoded(GuardianXPCReply.sessionStarted(status: result.status, grant: result.grant)))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch let error as GuardianChildSessionError {
      reply(childSessionFailure(error))
    } catch let error as GuardianLifecycleAuthenticationError {
      reply(encoded(GuardianXPCReply.rejected(
        .lifecycleAuthenticationDenied,
        message: error.localizedDescription
      )))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(
        .invalidRequest,
        message: "The child-session start request is malformed."
      )))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func completeChildSession(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianCompleteChildSessionRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)
      let assertion = try GuardianLifecycleAuthenticator.authenticate(
        assertion: request.lifecycleAssertion,
        authenticationTag: request.lifecycleAuthenticationTag,
        key: lifecycleKey
      )
      let eligibleAtMilliseconds = Int64(
        (request.proof.eligibleAt.timeIntervalSince1970 * 1_000).rounded()
      )
      guard assertion.mode == .free,
            assertion.serviceSessionId == request.proof.serviceSessionID,
            assertion.weekId == request.proof.weekID,
            assertion.day == request.proof.day,
            assertion.eligibleAtMilliseconds == eligibleAtMilliseconds,
            assertion.requiredCompleted == request.proof.requiredCompleted,
            assertion.requiredTarget == request.proof.requiredTarget,
            assertion.optionalCompleted == request.proof.optionalCompleted,
            assertion.optionalTarget == request.proof.optionalTarget else {
        throw GuardianLifecycleAuthenticationError.invalidAssertion
      }
      let status = try store.completeChildSession(request)
      reply(encoded(GuardianXPCReply.accepted(
        status: status,
        message: "Verified daily completion accepted; Homework mode disabled."
      )))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch let error as GuardianChildSessionError {
      reply(childSessionFailure(error))
    } catch let error as GuardianLifecycleAuthenticationError {
      reply(encoded(GuardianXPCReply.rejected(
        .lifecycleAuthenticationDenied,
        message: error.localizedDescription
      )))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(
        .invalidRequest,
        message: "The child-session completion request is malformed."
      )))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func issueServiceAccess(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianServiceAccessRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)
      let authentication = try GuardianServiceBrokerAuthenticator.serviceAccess(key: lifecycleKey)
      reply(encoded(GuardianXPCReply.serviceAuthenticated(
        authentication,
        message: "Short-lived signed user-session service access issued."
      )))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(
        .invalidRequest,
        message: "The user-session service-access request is malformed."
      )))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func authorizeParentChallenge(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  ) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianParentChallengeAuthorizationRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)
      if request.approved {
        // Approval is useful only when the daemon independently revalidates the
        // native Authorization Services reference. A denial needs no privilege.
        try GuardianAuthorization.validateAdministratorExternalForm(authorizationExternalForm)
      }
      let authentication = try GuardianServiceBrokerAuthenticator.parentAuthorization(
        challengeID: request.challengeID,
        purpose: request.purpose,
        approved: request.approved,
        key: lifecycleKey
      )
      reply(encoded(GuardianXPCReply.serviceAuthenticated(
        authentication,
        message: request.approved
          ? "Administrator authorization verified for the Parent request."
          : "Parent authorization was denied."
      )))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch let error as GuardianAuthorizationError {
      reply(encoded(GuardianXPCReply.rejected(.authorizationDenied, message: error.localizedDescription)))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(
        .invalidRequest,
        message: "The Parent authorization request is malformed."
      )))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func setHomeworkMode(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  ) {
    do {
      try validatePayloadSize(encodedRequest)
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
      reply(validationFailure(error))
    } catch let error as GuardianAuthorizationError {
      reply(encoded(GuardianXPCReply.rejected(.authorizationDenied, message: error.localizedDescription)))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(.invalidRequest, message: "The Homework-mode request is malformed.")))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  func replacePolicy(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  ) {
    do {
      try validatePayloadSize(encodedRequest)
      let request = try GuardianWireCodec.decode(
        GuardianReplacePolicyRequest.self,
        from: encodedRequest
      )
      try GuardianRequestValidator.validate(request)

      // Policy changes are privileged. Revalidate the caller's short-lived
      // external authorization immediately before persisting the replacement.
      try GuardianAuthorization.validateAdministratorExternalForm(authorizationExternalForm)
      let status = try store.apply(request)
      reply(encoded(GuardianXPCReply.accepted(
        status: status,
        message: "Blocked-application policy revision \(status.policy.revision) installed."
      )))
    } catch let error as GuardianRequestValidationError {
      reply(validationFailure(error))
    } catch let error as GuardianAuthorizationError {
      reply(encoded(GuardianXPCReply.rejected(.authorizationDenied, message: error.localizedDescription)))
    } catch is DecodingError {
      reply(encoded(GuardianXPCReply.rejected(.invalidRequest, message: "The policy replacement is malformed.")))
    } catch {
      reply(encoded(GuardianXPCReply.rejected(.internalFailure, message: error.localizedDescription)))
    }
  }

  private func validatePayloadSize(_ data: Data) throws {
    guard data.count <= GuardianConstants.maximumPayloadBytes else {
      throw GuardianRequestValidationError.payloadTooLarge(data.count)
    }
  }

  private func validationFailure(_ error: GuardianRequestValidationError) -> Data {
    let code: GuardianXPCErrorCode
    switch error {
    case .duplicateRequest: code = .duplicateRequest
    case .staleRequest, .requestFromFuture: code = .staleRequest
    case .unsupportedProtocol: code = .unsupportedProtocol
    case .duplicateBundleIdentifier,
         .invalidAuditReason,
         .invalidBundleIdentifier,
         .invalidChildSessionDay,
         .invalidCompletionCapability,
         .invalidCompletionProof,
         .invalidParentChallenge,
         .invalidPolicyRevision,
         .invalidPolicySize,
         .invalidWeekID,
         .payloadTooLarge,
         .protectedBundleIdentifier:
      code = .invalidRequest
    }
    return encoded(GuardianXPCReply.rejected(code, message: error.localizedDescription))
  }

  private func childSessionFailure(_ error: GuardianChildSessionError) -> Data {
    let code: GuardianXPCErrorCode
    switch error {
    case .completionCapabilityDenied:
      code = .sessionCapabilityDenied
    case .sessionAlreadyClosed:
      code = .sessionClosed
    case .activeSessionMismatch, .completionProofMismatch:
      code = .sessionConflict
    }
    return encoded(GuardianXPCReply.rejected(code, message: error.localizedDescription))
  }

  private func makeCompletionCapability() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else { throw DaemonError.randomGenerationFailed(status) }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
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
      let lifecycleKey = try GuardianLifecycleKeyStore.loadOrCreate(at: lifecycleKeyURL)
      let service = GuardianDaemonService(store: store, lifecycleKey: lifecycleKey)
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
  case randomGenerationFailed(OSStatus)

  var errorDescription: String? {
    switch self {
    case .incorrectCodeIdentity(let identifier):
      "The guardian daemon has the wrong signing identifier: \(identifier)."
    case .randomGenerationFailed(let status):
      "The guardian daemon could not generate a completion capability (Security status \(status))."
    }
  }
}
