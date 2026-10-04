import AppKit
import Foundation
import GuardianXPC

private struct AgentOptions {
  let once: Bool
  let observeOnly: Bool

  static func parse(_ arguments: [String]) throws -> AgentOptions {
    let allowed = Set(["--once", "--observe-only"])
    guard arguments.allSatisfy(allowed.contains) else { throw AgentError.invalidArguments }
    return AgentOptions(
      once: arguments.contains("--once"),
      observeOnly: arguments.contains("--observe-only")
    )
  }
}

private enum ServiceLearningMode: String, Decodable {
  case inactive
  case homework
  case free
}

private struct ServiceCompletionProof: Decodable {
  let serviceSessionId: UUID
  let weekId: String
  let day: String
  let eligibleAt: String
  let requiredCompleted: Int
  let requiredTarget: Int
  let optionalCompleted: Int
  let optionalTarget: Int

  func guardianProof() throws -> GuardianServiceCompletionProof {
    GuardianServiceCompletionProof(
      serviceSessionID: serviceSessionId,
      weekID: weekId,
      day: day,
      eligibleAt: try ServiceDate.parse(eligibleAt),
      requiredCompleted: requiredCompleted,
      requiredTarget: requiredTarget,
      optionalCompleted: optionalCompleted,
      optionalTarget: optionalTarget
    )
  }
}

private struct ServiceChildSession: Decodable {
  let serviceSessionId: UUID
  let weekId: String
  let day: String
  let completionProof: ServiceCompletionProof?
}

private struct ServiceLifecycleAuthentication: Decodable {
  let scheme: String
  let assertion: String
  let authenticationTag: String

  func decoded() throws -> (assertion: Data, authenticationTag: Data) {
    guard scheme == "hmac-sha256",
          let assertionData = Data(base64URLString: assertion),
          let tagData = Data(base64URLString: authenticationTag),
          assertionData.count <= 4_096,
          tagData.count == 32 else {
      throw AgentError.invalidServiceLifecycle("Lifecycle authentication data is malformed.")
    }
    return (assertionData, tagData)
  }
}

private struct ServiceLifecycle: Decodable {
  let mode: ServiceLearningMode
  let session: ServiceChildSession?
  let authentication: ServiceLifecycleAuthentication?
}

private struct UserBrokerCompletionBody: Encodable {
  let success: Bool
  let result: UserBrokerOperationResult?
  let error: String?
  let code: String?
}

private struct UserBrokerParentAuthentication: Encodable {
  let assertion: String
  let authenticationTag: String
}

private struct UserBrokerParentAuthorizationBody: Encodable {
  let challengeId: String
  let authentication: UserBrokerParentAuthentication
}

private extension Data {
  init?(base64URLString: String) {
    guard base64URLString.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
      return nil
    }
    var normalized = base64URLString
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    normalized.append(String(repeating: "=", count: (4 - normalized.count % 4) % 4))
    self.init(base64Encoded: normalized, options: [])
  }
}

private enum ServiceDate {
  static func parse(_ value: String) throws -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else {
      throw AgentError.invalidServiceLifecycle("The completion timestamp is malformed.")
    }
    return date
  }
}

private final class ServiceReplyBox: @unchecked Sendable {
  private let lock = NSLock()
  private var result: Result<(Data, URLResponse), Error>?

  func set(_ result: Result<(Data, URLResponse), Error>) {
    lock.lock()
    defer { lock.unlock() }
    guard self.result == nil else { return }
    self.result = result
  }

  func get() -> Result<(Data, URLResponse), Error>? {
    lock.lock()
    defer { lock.unlock() }
    return result
  }
}

private final class GuardianServiceClient {
  private static let lifecycleURL = URL(
    string: "http://127.0.0.1:4179/api/guardian/lifecycle"
  )!
  private static let brokerWorkURL = URL(
    string: "http://127.0.0.1:4179/api/user-broker/work"
  )!
  private static let brokerParentAuthorizationURL = URL(
    string: "http://127.0.0.1:4179/api/user-broker/parent-authorization"
  )!
  private let session: URLSession

  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 5
    configuration.timeoutIntervalForResource = 5
    session = URLSession(configuration: configuration)
  }

  func fetchLifecycle() throws -> ServiceLifecycle {
    var request = URLRequest(url: Self.lifecycleURL)
    request.httpMethod = "GET"
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    let semaphore = DispatchSemaphore(value: 0)
    let box = ServiceReplyBox()
    session.dataTask(with: request) { data, response, error in
      if let error {
        box.set(.failure(error))
      } else if let data, let response {
        box.set(.success((data, response)))
      } else {
        box.set(.failure(AgentError.invalidServiceLifecycle("The local service returned no response.")))
      }
      semaphore.signal()
    }.resume()

    guard semaphore.wait(timeout: .now() + 6) == .success else {
      throw AgentError.serviceUnavailable("The local service timed out.")
    }
    guard let result = box.get() else {
      throw AgentError.serviceUnavailable("The local service returned no result.")
    }
    let (data, response) = try result.get()
    guard let http = response as? HTTPURLResponse,
          http.url == Self.lifecycleURL,
          (200..<300).contains(http.statusCode) else {
      throw AgentError.serviceUnavailable("The local service rejected its lifecycle request.")
    }
    guard data.count <= 65_536 else {
      throw AgentError.invalidServiceLifecycle("The local service lifecycle response is too large.")
    }
    do {
      return try JSONDecoder().decode(ServiceLifecycle.self, from: data)
    } catch {
      throw AgentError.invalidServiceLifecycle(error.localizedDescription)
    }
  }

  func fetchBrokerWork(
    authentication: GuardianServiceBrokerEnvelope
  ) throws -> UserBrokerWork {
    var request = URLRequest(url: Self.brokerWorkURL)
    request.httpMethod = "GET"
    request.setValue("Bearer \(authentication.bearerCredential)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    return try JSONDecoder().decode(UserBrokerWork.self, from: perform(request))
  }

  func completeBrokerOperation(
    _ operationID: String,
    body: UserBrokerCompletionBody,
    authentication: GuardianServiceBrokerEnvelope
  ) throws {
    guard let escapedID = operationID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
          let url = URL(string: "http://127.0.0.1:4179/api/user-broker/operations/\(escapedID)") else {
      throw AgentError.invalidServiceLifecycle("The user-session operation identifier is invalid.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(authentication.bearerCredential)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    _ = try perform(request)
  }

  func submitParentAuthorization(
    challengeID: String,
    authentication: GuardianServiceBrokerEnvelope
  ) throws {
    var request = URLRequest(url: Self.brokerParentAuthorizationURL)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(UserBrokerParentAuthorizationBody(
      challengeId: challengeID,
      authentication: UserBrokerParentAuthentication(
        assertion: authentication.assertion.base64URLEncodedString(),
        authenticationTag: authentication.authenticationTag.base64URLEncodedString()
      )
    ))
    _ = try perform(request)
  }

  private func perform(_ request: URLRequest) throws -> Data {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ServiceReplyBox()
    session.dataTask(with: request) { data, response, error in
      if let error {
        box.set(.failure(error))
      } else if let data, let response {
        box.set(.success((data, response)))
      } else {
        box.set(.failure(AgentError.serviceUnavailable("The local service returned no response.")))
      }
      semaphore.signal()
    }.resume()
    guard semaphore.wait(timeout: .now() + 6) == .success,
          let result = box.get() else {
      throw AgentError.serviceUnavailable("The local service timed out.")
    }
    let (data, response) = try result.get()
    guard let http = response as? HTTPURLResponse,
          (200..<300).contains(http.statusCode),
          data.count <= 1_048_576 else {
      throw AgentError.serviceUnavailable("The local service rejected the user-session broker request.")
    }
    return data
  }
}

@main
private struct GuardianAgentApplication {
  static func main() {
    do {
      let identity = try GuardianCurrentCodeSignature.identity()
      guard identity.bundleIdentifier == GuardianConstants.agentBundleIdentifier else {
        throw AgentError.incorrectCodeIdentity(identity.bundleIdentifier)
      }
      let options = try AgentOptions.parse(Array(CommandLine.arguments.dropFirst()))
      let client = try GuardianDaemonClient()
      let serviceClient = GuardianServiceClient()
      let googleBroker = GoogleUserSessionBroker()
      var childGrant: GuardianChildSessionGrant?
      repeat {
        try runCycle(
          client: client,
          serviceClient: serviceClient,
          googleBroker: googleBroker,
          childGrant: &childGrant,
          observeOnly: options.observeOnly
        )
        if !options.once { Thread.sleep(forTimeInterval: 5) }
      } while !options.once
    } catch {
      fputs("guardian-agent: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }

  private static func runCycle(
    client: GuardianDaemonClient,
    serviceClient: GuardianServiceClient,
    googleBroker: GoogleUserSessionBroker,
    childGrant: inout GuardianChildSessionGrant?,
    observeOnly: Bool
  ) throws {
    do {
      let lifecycle = try serviceClient.fetchLifecycle()
      try reconcileLifecycle(lifecycle, client: client, childGrant: &childGrant)
    } catch {
      // A service outage must never turn restrictions off. Continue asking the
      // daemon to enforce its last persisted state while launchd/service repair
      // restores lifecycle synchronization.
      fputs("guardian-agent: lifecycle sync deferred: \(error.localizedDescription)\n", stderr)
    }

    do {
      try processUserBrokerWork(
        client: client,
        serviceClient: serviceClient,
        googleBroker: googleBroker
      )
    } catch {
      fputs("guardian-agent: user-session broker deferred: \(error.localizedDescription)\n", stderr)
    }

    let observedApplication = NSWorkspace.shared.frontmostApplication
    let observedIdentifier = observedApplication?.bundleIdentifier
    let response = try client.evaluateApplication(GuardianApplicationEvaluationRequest(
      activeBundleIdentifier: observedIdentifier
    ))
    guard response.success,
          let status = response.status,
          let decision = response.decision else {
      throw AgentError.daemonRejected(response.message)
    }

    var action = "none"
    if decision == .blocked, !observeOnly,
       let observedApplication,
       observedApplication.bundleIdentifier == observedIdentifier,
       NSWorkspace.shared.frontmostApplication?.processIdentifier == observedApplication.processIdentifier {
      action = observedApplication.terminate() ? "terminate-requested" : "terminate-rejected"
    } else if decision == .blocked, observeOnly {
      action = "would-terminate"
    }

    print(
      "[agent] homework=\(status.homeworkMode ? "on" : "off") "
        + "policy=\(status.policy.revision) active=\(observedIdentifier ?? "unavailable") "
        + "decision=\(decision.rawValue) action=\(action)"
    )
  }

  private static func processUserBrokerWork(
    client: GuardianDaemonClient,
    serviceClient: GuardianServiceClient,
    googleBroker: GoogleUserSessionBroker
  ) throws {
    let access = try serviceAuthentication(client: client)
    let work = try serviceClient.fetchBrokerWork(authentication: access)

    if let challenge = work.parentAuthorizationChallenge {
      let approved: Bool
      let authorization: Data
      do {
        authorization = try GuardianAuthorization.requestAdministratorExternalForm()
        approved = true
      } catch {
        authorization = Data()
        approved = false
      }
      let response = try client.authorizeParentChallenge(
        GuardianParentChallengeAuthorizationRequest(
          challengeID: challenge.id,
          purpose: challenge.purpose,
          approved: approved
        ),
        authorizationExternalForm: authorization
      )
      guard response.success, let authentication = response.serviceAuthentication else {
        throw AgentError.daemonRejected(response.message)
      }
      try serviceClient.submitParentAuthorization(
        challengeID: challenge.id,
        authentication: authentication
      )
    }

    if let operation = work.operation {
      let completion: UserBrokerCompletionBody
      do {
        completion = UserBrokerCompletionBody(
          success: true,
          result: try googleBroker.process(operation),
          error: nil,
          code: nil
        )
      } catch {
        completion = UserBrokerCompletionBody(
          success: false,
          result: nil,
          error: error.localizedDescription,
          code: "google_user_session_operation_failed"
        )
      }
      try serviceClient.completeBrokerOperation(
        operation.id,
        body: completion,
        authentication: try serviceAuthentication(client: client)
      )
    }
  }

  private static func serviceAuthentication(
    client: GuardianDaemonClient
  ) throws -> GuardianServiceBrokerEnvelope {
    let response = try client.issueServiceAccess()
    guard response.success, let authentication = response.serviceAuthentication else {
      throw AgentError.daemonRejected(response.message)
    }
    return authentication
  }

  private static func reconcileLifecycle(
    _ lifecycle: ServiceLifecycle,
    client: GuardianDaemonClient,
    childGrant: inout GuardianChildSessionGrant?
  ) throws {
    guard lifecycle.mode != .inactive else { return }
    guard let serviceSession = lifecycle.session else {
      throw AgentError.invalidServiceLifecycle("An active learning mode needs a service session.")
    }
    guard let authentication = lifecycle.authentication else {
      throw AgentError.invalidServiceLifecycle("The root service did not authenticate its lifecycle.")
    }
    let authenticatedLifecycle = try authentication.decoded()

    let statusReply = try client.fetchStatus()
    guard statusReply.success, let status = statusReply.status else {
      throw AgentError.daemonRejected(statusReply.message)
    }

    if status.lastClosedChildSession?.serviceSessionID == serviceSession.serviceSessionId {
      childGrant = nil
      return
    }

    if childGrant?.session.serviceSessionID != serviceSession.serviceSessionId {
      childGrant = nil
    }
    if childGrant == nil {
      let startReply = try client.beginChildSession(GuardianBeginChildSessionRequest(
        serviceSessionID: serviceSession.serviceSessionId,
        weekID: serviceSession.weekId,
        day: serviceSession.day,
        lifecycleAssertion: authenticatedLifecycle.assertion,
        lifecycleAuthenticationTag: authenticatedLifecycle.authenticationTag
      ))
      guard startReply.success, let grant = startReply.sessionGrant else {
        throw AgentError.daemonRejected(startReply.message)
      }
      childGrant = grant
    }

    guard lifecycle.mode == .free else { return }
    guard let proof = serviceSession.completionProof else {
      throw AgentError.invalidServiceLifecycle("Free mode is missing its completion proof.")
    }
    guard proof.serviceSessionId == serviceSession.serviceSessionId,
          proof.weekId == serviceSession.weekId,
          proof.day == serviceSession.day,
          let grant = childGrant else {
      throw AgentError.invalidServiceLifecycle("The completion proof does not match the active service session.")
    }

    let completionReply = try client.completeChildSession(GuardianCompleteChildSessionRequest(
      guardianSessionID: grant.session.guardianSessionID,
      completionCapability: grant.completionCapability,
      proof: try proof.guardianProof(),
      lifecycleAssertion: authenticatedLifecycle.assertion,
      lifecycleAuthenticationTag: authenticatedLifecycle.authenticationTag
    ))
    guard completionReply.success else {
      throw AgentError.daemonRejected(completionReply.message)
    }
    childGrant = nil
  }
}

private enum AgentError: Error, LocalizedError {
  case daemonRejected(String)
  case incorrectCodeIdentity(String)
  case invalidArguments
  case invalidServiceLifecycle(String)
  case serviceUnavailable(String)

  var errorDescription: String? {
    switch self {
    case .daemonRejected(let message): "The guardian daemon rejected the agent: \(message)"
    case .incorrectCodeIdentity(let identifier):
      "The guardian agent has the wrong signing identifier: \(identifier)."
    case .invalidArguments:
      "Only --once and --observe-only are supported."
    case .invalidServiceLifecycle(let message):
      "The local service lifecycle is invalid: \(message)"
    case .serviceUnavailable(let message):
      message
    }
  }
}
