import AppKit
import Darwin
import Foundation
import Security

private let guardianVersion = "0.1.0"

private struct GuardianPolicy: Decodable {
  let version: String
  let blockedBundleIds: [String]
}

private struct GuardianServiceStatus: Decodable {
  let mode: String
  let homeworkMode: Bool
  let policy: GuardianPolicy
  let parentAuthorizationChallenge: ParentAuthorizationChallenge?
}

private struct ParentAuthorizationChallenge: Decodable {
  let id: String
  let purpose: String
  let purposeLabel: String
}

private struct GuardianHeartbeat: Encodable {
  let guardianId: String
  let mode: String
  let activeBundleId: String?
  let decision: String
  let version: String
}

private struct ParentAuthorizationApproval: Encodable {
  let challengeId: String
  let approved: Bool
}

private struct CommandOptions {
  var runOnce = false
  var checkOnly = false
  var requestEnforcement = false
  var simulateHomework = false
  var fixtureBundleId: String?
  var configurationPath: String?
  var showHelp = false

  static func parse(_ arguments: [String]) throws -> CommandOptions {
    var options = CommandOptions()
    var index = 0
    while index < arguments.count {
      switch arguments[index] {
      case "--once": options.runOnce = true
      case "--check": options.checkOnly = true
      case "--enforce": options.requestEnforcement = true
      case "--simulate-homework": options.simulateHomework = true
      case "--fixture-bundle-id":
        index += 1
        guard index < arguments.count else { throw GuardianError.invalidArguments("--fixture-bundle-id requires a value") }
        options.fixtureBundleId = arguments[index]
      case "--config":
        index += 1
        guard index < arguments.count else { throw GuardianError.invalidArguments("--config requires a path") }
        options.configurationPath = arguments[index]
      case "--help", "-h": options.showHelp = true
      default: throw GuardianError.invalidArguments("Unknown option: \(arguments[index])")
      }
      index += 1
    }
    return options
  }
}

private final class GuardianClient {
  private let baseURL: URL
  private let sharedSecret: String?

  init(baseURL: String, sharedSecret: String?) throws {
    guard let url = URL(string: baseURL), url.scheme == "http", url.host == "127.0.0.1" else {
      throw GuardianError.invalidArguments("serviceBaseURL must use http://127.0.0.1")
    }
    self.baseURL = url
    self.sharedSecret = sharedSecret?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func status() async throws -> GuardianServiceStatus {
    let url = baseURL.appending(path: "api/guardian/status")
    var request = URLRequest(url: url)
    authenticate(&request)
    let (data, response) = try await URLSession.shared.data(for: request)
    try validate(response)
    return try JSONDecoder().decode(GuardianServiceStatus.self, from: data)
  }

  func heartbeat(_ heartbeat: GuardianHeartbeat) async throws {
    let url = baseURL.appending(path: "api/guardian/heartbeat")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authenticate(&request)
    request.httpBody = try JSONEncoder().encode(heartbeat)
    let (_, response) = try await URLSession.shared.data(for: request)
    try validate(response)
  }

  func answerParentAuthorization(challengeId: String, approved: Bool) async throws {
    let url = baseURL.appending(path: "api/guardian/parent-approval")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authenticate(&request)
    request.httpBody = try JSONEncoder().encode(ParentAuthorizationApproval(
      challengeId: challengeId,
      approved: approved
    ))
    let (_, response) = try await URLSession.shared.data(for: request)
    try validate(response)
  }

  private func authenticate(_ request: inout URLRequest) {
    guard let sharedSecret, !sharedSecret.isEmpty else { return }
    request.setValue("Bearer \(sharedSecret)", forHTTPHeaderField: "Authorization")
  }

  private func validate(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw GuardianError.invalidServiceResponse(status) }
  }
}

private final class ParentAuthorizationCoordinator {
  private var decisions: [String: Bool] = [:]

  func decision(for challenge: ParentAuthorizationChallenge) -> Bool {
    if let decision = decisions[challenge.id] { return decision }
    print("[parent-authorization] macOS approval requested: \(challenge.purposeLabel)")
    let decision = requestAdministratorAuthorization()
    decisions[challenge.id] = decision
    return decision
  }

  func markDelivered(_ challengeId: String) {
    decisions.removeValue(forKey: challengeId)
  }

  private func requestAdministratorAuthorization() -> Bool {
    var authorization: AuthorizationRef?
    let createStatus = AuthorizationCreate(nil, nil, [], &authorization)
    guard createStatus == errAuthorizationSuccess, let authorization else { return false }
    defer { AuthorizationFree(authorization, [.destroyRights]) }

    return "system.privilege.admin".withCString { rightName in
      var item = AuthorizationItem(
        name: rightName,
        valueLength: 0,
        value: nil,
        flags: 0
      )
      return withUnsafeMutablePointer(to: &item) { itemPointer in
        var rights = AuthorizationRights(count: 1, items: itemPointer)
        let status = AuthorizationCopyRights(
          authorization,
          &rights,
          nil,
          [.interactionAllowed, .extendRights, .preAuthorize],
          nil
        )
        return status == errAuthorizationSuccess
      }
    }
  }
}

@main
struct HomeworkGuardian {
  static func main() async {
    do {
      let options = try CommandOptions.parse(Array(CommandLine.arguments.dropFirst()))
      if options.showHelp {
        printHelp()
        return
      }
      let loaded = try GuardianConfiguration.load(from: options.configurationPath)
      let enforcing = try enforcementEnabled(
        requested: options.requestEnforcement,
        configurationAllows: loaded.configuration.allowEnforcement,
        simulating: options.simulateHomework
      )

      if options.checkOnly {
        print("Guardian configuration is valid (\(loaded.source)).")
        print("Mode: \(enforcing ? "enforcing" : "dry-run")")
        print("Service: \(loaded.configuration.serviceBaseURL)")
        print("Parent authorization: \((loaded.configuration.sharedSecret?.count ?? 0) >= 32 ? "configured" : "not configured")")
        return
      }

      if options.simulateHomework {
        let bundleId = options.fixtureBundleId ?? "com.apple.Terminal"
        let decision = decideGuardianAction(
          homeworkMode: true,
          activeBundleId: bundleId,
          blockedBundleIds: ["com.apple.Safari", "com.apple.Terminal", "com.roblox.Roblox"]
        )
        printResult(homeworkMode: true, bundleId: bundleId, decision: decision, enforcing: false, simulated: true)
        return
      }

      let client = try GuardianClient(
        baseURL: loaded.configuration.serviceBaseURL,
        sharedSecret: loaded.configuration.sharedSecret
      )
      let authorizationCoordinator = ParentAuthorizationCoordinator()
      repeat {
        do {
          try await runCycle(
            client: client,
            configuration: loaded.configuration,
            enforcing: enforcing,
            fixtureBundleId: options.fixtureBundleId,
            authorizationCoordinator: authorizationCoordinator
          )
        } catch {
          fputs("guardian: \(error.localizedDescription)\n", stderr)
          if options.runOnce { throw error }
        }
        if !options.runOnce {
          let nanoseconds = UInt64(max(1, loaded.configuration.heartbeatIntervalSeconds) * 1_000_000_000)
          try await Task.sleep(nanoseconds: nanoseconds)
        }
      } while !options.runOnce
    } catch {
      fputs("guardian: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }

  private static func runCycle(
    client: GuardianClient,
    configuration: GuardianConfiguration,
    enforcing: Bool,
    fixtureBundleId: String?,
    authorizationCoordinator: ParentAuthorizationCoordinator
  ) async throws {
    let serviceStatus = try await client.status()
    let frontmost = NSWorkspace.shared.frontmostApplication
    let bundleId = fixtureBundleId ?? frontmost?.bundleIdentifier
    let decision = decideGuardianAction(
      homeworkMode: serviceStatus.homeworkMode,
      activeBundleId: bundleId,
      blockedBundleIds: Set(serviceStatus.policy.blockedBundleIds)
    )

    if let challenge = serviceStatus.parentAuthorizationChallenge {
      let approved = authorizationCoordinator.decision(for: challenge)
      try await client.answerParentAuthorization(challengeId: challenge.id, approved: approved)
      authorizationCoordinator.markDelivered(challenge.id)
      print("[parent-authorization] \(approved ? "approved" : "denied") purpose=\(challenge.purpose)")
    }

    if enforcing, decision == .blocked, frontmost?.bundleIdentifier == bundleId {
      _ = frontmost?.terminate()
    }

    try await client.heartbeat(GuardianHeartbeat(
      guardianId: configuration.guardianId,
      mode: enforcing ? "enforcing" : "dry-run",
      activeBundleId: bundleId,
      decision: decision.rawValue,
      version: guardianVersion
    ))
    printResult(
      homeworkMode: serviceStatus.homeworkMode,
      bundleId: bundleId,
      decision: decision,
      enforcing: enforcing,
      simulated: false
    )
  }

  private static func printResult(
    homeworkMode: Bool,
    bundleId: String?,
    decision: GuardianDecision,
    enforcing: Bool,
    simulated: Bool
  ) {
    let prefix = simulated ? "simulation" : enforcing ? "enforcing" : "dry-run"
    let action = decision == .blocked ? (enforcing ? "terminate-requested" : "would-terminate") : "none"
    print("[\(prefix)] homework=\(homeworkMode ? "on" : "off") active=\(bundleId ?? "unavailable") decision=\(decision.rawValue) action=\(action)")
  }

  private static func printHelp() {
    print("""
    homework-guardian [options]

      --once                     Run one service-connected observation and exit
      --check                    Validate configuration without contacting the service
      --config PATH              Read the parent-owned JSON configuration
      --fixture-bundle-id ID     Substitute a bundle ID for safe testing
      --simulate-homework        Run an offline dry-run Homework-mode simulation
      --enforce                  Request enforcement; also requires allowEnforcement=true
      --help                     Show this help

    The default mode is dry-run. It observes and reports but never closes an app.
    """)
  }
}
