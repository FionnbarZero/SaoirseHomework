import Foundation

public enum GuardianDaemonClientError: Error, LocalizedError {
  case connectionFailed(String)
  case invalidReply
  case timedOut

  public var errorDescription: String? {
    switch self {
    case .connectionFailed(let message): "Guardian daemon connection failed: \(message)"
    case .invalidReply: "Guardian daemon returned an invalid response."
    case .timedOut: "Guardian daemon did not respond within ten seconds."
    }
  }
}

private final class GuardianReplyBox: @unchecked Sendable {
  private let lock = NSLock()
  private var result: Result<Data, Error>?

  func set(_ result: Result<Data, Error>) {
    lock.lock()
    defer { lock.unlock() }
    guard self.result == nil else { return }
    self.result = result
  }

  func get() -> Result<Data, Error>? {
    lock.lock()
    defer { lock.unlock() }
    return result
  }
}

public final class GuardianDaemonClient {
  private let connection: NSXPCConnection

  public init() throws {
    let requirement = try GuardianCurrentCodeSignature.requirement(
      allowedBundleIdentifiers: [GuardianConstants.daemonBundleIdentifier]
    )
    let connection = NSXPCConnection(
      machServiceName: GuardianConstants.daemonMachService,
      options: .privileged
    )
    connection.remoteObjectInterface = NSXPCInterface(with: GuardianDaemonXPCProtocol.self)
    connection.setCodeSigningRequirement(requirement)
    connection.activate()
    self.connection = connection
  }

  deinit {
    connection.invalidate()
  }

  public func fetchStatus() throws -> GuardianXPCReply {
    try perform { service, reply in service.fetchStatus(withReply: reply) }
  }

  public func evaluateApplication(
    _ request: GuardianApplicationEvaluationRequest
  ) throws -> GuardianXPCReply {
    let encodedRequest = try GuardianWireCodec.encode(request)
    return try perform { service, reply in
      service.evaluateApplication(encodedRequest, withReply: reply)
    }
  }

  public func beginChildSession(
    _ request: GuardianBeginChildSessionRequest
  ) throws -> GuardianXPCReply {
    let encodedRequest = try GuardianWireCodec.encode(request)
    return try perform { service, reply in
      service.beginChildSession(encodedRequest, withReply: reply)
    }
  }

  public func completeChildSession(
    _ request: GuardianCompleteChildSessionRequest
  ) throws -> GuardianXPCReply {
    let encodedRequest = try GuardianWireCodec.encode(request)
    return try perform { service, reply in
      service.completeChildSession(encodedRequest, withReply: reply)
    }
  }

  public func setHomeworkMode(
    _ request: GuardianSetHomeworkModeRequest,
    authorizationExternalForm: Data
  ) throws -> GuardianXPCReply {
    let encodedRequest = try GuardianWireCodec.encode(request)
    return try perform { service, reply in
      service.setHomeworkMode(
        encodedRequest,
        authorizationExternalForm: authorizationExternalForm,
        withReply: reply
      )
    }
  }

  public func replacePolicy(
    _ request: GuardianReplacePolicyRequest,
    authorizationExternalForm: Data
  ) throws -> GuardianXPCReply {
    let encodedRequest = try GuardianWireCodec.encode(request)
    return try perform { service, reply in
      service.replacePolicy(
        encodedRequest,
        authorizationExternalForm: authorizationExternalForm,
        withReply: reply
      )
    }
  }

  private func perform(
    _ operation: (GuardianDaemonXPCProtocol, @escaping (Data) -> Void) -> Void
  ) throws -> GuardianXPCReply {
    let semaphore = DispatchSemaphore(value: 0)
    let box = GuardianReplyBox()
    let errorHandler: (Error) -> Void = { error in
      box.set(.failure(GuardianDaemonClientError.connectionFailed(error.localizedDescription)))
      semaphore.signal()
    }
    guard let service = connection.remoteObjectProxyWithErrorHandler(errorHandler)
      as? GuardianDaemonXPCProtocol else {
      throw GuardianDaemonClientError.invalidReply
    }
    operation(service) { data in
      box.set(.success(data))
      semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 10) == .success else {
      throw GuardianDaemonClientError.timedOut
    }
    guard let result = box.get() else { throw GuardianDaemonClientError.invalidReply }
    let data = try result.get()
    return try GuardianWireCodec.decode(GuardianXPCReply.self, from: data)
  }
}
