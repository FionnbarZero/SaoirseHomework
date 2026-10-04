import Foundation

enum GuardianDecision: String, Codable, Equatable {
  case inactive
  case allowed
  case blocked
  case unavailable
}

struct GuardianConfiguration: Codable, Equatable {
  let guardianId: String
  let serviceBaseURL: String
  let heartbeatIntervalSeconds: Double
  let allowEnforcement: Bool
  let sharedSecret: String?

  static var safeDefault: GuardianConfiguration {
    let host = Host.current().localizedName ?? "mac"
    return GuardianConfiguration(
      guardianId: "\(host)-\(NSUserName())",
      serviceBaseURL: "http://127.0.0.1:4179",
      heartbeatIntervalSeconds: 5,
      allowEnforcement: false,
      sharedSecret: nil
    )
  }

  static func load(from path: String?) throws -> (configuration: GuardianConfiguration, source: String) {
    guard let path else { return (.safeDefault, "built-in safe defaults") }
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return (try JSONDecoder().decode(GuardianConfiguration.self, from: data), path)
  }
}

func decideGuardianAction(
  homeworkMode: Bool,
  activeBundleId: String?,
  blockedBundleIds: Set<String>
) -> GuardianDecision {
  guard homeworkMode else { return .inactive }
  guard let activeBundleId, !activeBundleId.isEmpty else { return .unavailable }
  return blockedBundleIds.contains(activeBundleId) ? .blocked : .allowed
}

func enforcementEnabled(requested: Bool, configurationAllows: Bool, simulating: Bool) throws -> Bool {
  if requested && simulating {
    throw GuardianError.invalidArguments("--enforce cannot be combined with --simulate-homework")
  }
  if requested && !configurationAllows {
    throw GuardianError.enforcementNotAuthorized
  }
  return requested && configurationAllows
}

enum GuardianError: Error, LocalizedError, Equatable {
  case invalidArguments(String)
  case enforcementNotAuthorized
  case invalidServiceResponse(Int)

  var errorDescription: String? {
    switch self {
    case .invalidArguments(let message): message
    case .enforcementNotAuthorized:
      "Enforcement is disabled. Set allowEnforcement to true in the parent-owned configuration and pass --enforce."
    case .invalidServiceResponse(let status):
      "Homework service returned HTTP \(status)."
    }
  }
}
