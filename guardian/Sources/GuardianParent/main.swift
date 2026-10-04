import Foundation
import GuardianXPC
import ServiceManagement

private enum ParentCommand: String {
  case register
  case status
  case unregister
  case enableHomework = "enable-homework"
  case disableHomework = "disable-homework"
  case replacePolicy = "replace-policy"
}

private struct ParentOptions {
  let command: ParentCommand
  let reason: String?
  let blockedBundleIdentifiers: [String]

  static func parse(_ arguments: [String]) throws -> ParentOptions {
    guard let first = arguments.first, first.hasPrefix("--"),
          let command = ParentCommand(rawValue: String(first.dropFirst(2))) else {
      throw ParentError.invalidArguments
    }
    var reason: String?
    var blockedBundleIdentifiers: [String] = []
    var index = 1
    while index < arguments.count {
      guard index + 1 < arguments.count else { throw ParentError.invalidArguments }
      switch arguments[index] {
      case "--reason":
        guard reason == nil else { throw ParentError.invalidArguments }
        reason = arguments[index + 1]
      case "--blocked-bundle-id":
        blockedBundleIdentifiers.append(arguments[index + 1])
      default:
        throw ParentError.invalidArguments
      }
      index += 2
    }
    if (command == .enableHomework || command == .disableHomework), reason == nil {
      throw ParentError.missingReason
    }
    if command == .replacePolicy, reason == nil {
      throw ParentError.missingReason
    }
    if command == .replacePolicy, blockedBundleIdentifiers.isEmpty {
      throw ParentError.missingPolicy
    }
    if command != .replacePolicy, !blockedBundleIdentifiers.isEmpty {
      throw ParentError.invalidArguments
    }
    if command != .replacePolicy && command != .enableHomework && command != .disableHomework,
       reason != nil {
      throw ParentError.invalidArguments
    }
    return ParentOptions(
      command: command,
      reason: reason,
      blockedBundleIdentifiers: blockedBundleIdentifiers
    )
  }
}

private enum ParentError: Error, LocalizedError {
  case incorrectCodeIdentity(String)
  case invalidArguments
  case missingPolicy
  case missingReason
  case rejected(String)
  case requiresAppBundle

  var errorDescription: String? {
    switch self {
    case .incorrectCodeIdentity(let identifier):
      "The parent app has the wrong signing identifier: \(identifier)."
    case .invalidArguments:
      "Invalid command. Run with --help for usage."
    case .missingPolicy:
      "--replace-policy requires at least one --blocked-bundle-id."
    case .missingReason:
      "--reason is required for privileged Homework-mode and policy changes."
    case .rejected(let message):
      "The guardian daemon rejected the request: \(message)"
    case .requiresAppBundle:
      "Service registration must run from the signed Fionnbar Homework Parent.app bundle."
    }
  }
}

private struct ServiceCoordinator {
  let agent = SMAppService.agent(plistName: GuardianConstants.agentPlistName)
  let daemon = SMAppService.daemon(plistName: GuardianConstants.daemonPlistName)

  func register() throws {
    guard Bundle.main.bundleURL.pathExtension == "app" else { throw ParentError.requiresAppBundle }
    try registerIfNeeded(daemon, label: "daemon")
    try registerIfNeeded(agent, label: "agent")
    printStatus()
    if daemon.status == .requiresApproval {
      print("Administrator approval is still required in System Settings > General > Login Items.")
    }
  }

  func unregister() throws {
    if agent.status != .notRegistered { try agent.unregister() }
    if daemon.status != .notRegistered { try daemon.unregister() }
    printStatus()
  }

  func printStatus() {
    print("Agent: \(label(for: agent.status))")
    print("Daemon: \(label(for: daemon.status))")
  }

  private func registerIfNeeded(_ service: SMAppService, label: String) throws {
    switch service.status {
    case .notRegistered:
      try service.register()
      print("Registered \(label).")
    case .enabled:
      print("\(label.capitalized) is already enabled.")
    case .requiresApproval:
      print("\(label.capitalized) is registered and awaiting approval.")
    case .notFound:
      throw ParentError.requiresAppBundle
    @unknown default:
      throw ParentError.requiresAppBundle
    }
  }

  private func label(for status: SMAppService.Status) -> String {
    switch status {
    case .notRegistered: "not registered"
    case .enabled: "enabled"
    case .requiresApproval: "requires approval"
    case .notFound: "not found in app bundle"
    @unknown default: "unknown"
    }
  }
}

@main
private struct GuardianParentApplication {
  static func main() {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["--help"] || arguments == ["-h"] || arguments.isEmpty {
      printHelp()
      return
    }

    do {
      let identity = try GuardianCurrentCodeSignature.identity()
      guard identity.bundleIdentifier == GuardianConstants.parentBundleIdentifier else {
        throw ParentError.incorrectCodeIdentity(identity.bundleIdentifier)
      }
      let options = try ParentOptions.parse(arguments)
      let services = ServiceCoordinator()
      switch options.command {
      case .register:
        try services.register()
      case .unregister:
        try services.unregister()
      case .status:
        services.printStatus()
        try printDaemonStatus()
      case .enableHomework, .disableHomework:
        try changeHomeworkMode(
          enabled: options.command == .enableHomework,
          reason: options.reason ?? ""
        )
      case .replacePolicy:
        try replacePolicy(
          blockedBundleIdentifiers: options.blockedBundleIdentifiers,
          reason: options.reason ?? ""
        )
      }
    } catch {
      fputs("parent: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }

  private static func changeHomeworkMode(enabled: Bool, reason: String) throws {
    let authorization = try GuardianAuthorization.requestAdministratorExternalForm()
    let request = GuardianSetHomeworkModeRequest(enabled: enabled, auditReason: reason)
    let response = try GuardianDaemonClient().setHomeworkMode(
      request,
      authorizationExternalForm: authorization
    )
    guard response.success else { throw ParentError.rejected(response.message) }
    print(response.message)
  }

  private static func printDaemonStatus() throws {
    let response = try GuardianDaemonClient().fetchStatus()
    guard response.success, let status = response.status else {
      throw ParentError.rejected(response.message)
    }
    print("Homework mode: \(status.homeworkMode ? "enabled" : "disabled")")
    print("Policy revision: \(status.policy.revision)")
    print("Blocked applications: \(status.policy.blockedBundleIdentifiers.joined(separator: ", "))")
    print("Protocol: \(status.protocolVersion); service: \(status.serviceVersion)")
  }

  private static func replacePolicy(
    blockedBundleIdentifiers: [String],
    reason: String
  ) throws {
    try GuardianRequestValidator.validatePolicy(blockedBundleIdentifiers)
    let authorization = try GuardianAuthorization.requestAdministratorExternalForm()
    let request = GuardianReplacePolicyRequest(
      blockedBundleIdentifiers: blockedBundleIdentifiers,
      auditReason: reason
    )
    let response = try GuardianDaemonClient().replacePolicy(
      request,
      authorizationExternalForm: authorization
    )
    guard response.success else { throw ParentError.rejected(response.message) }
    print(response.message)
  }

  private static func printHelp() {
    print("""
    Fionnbar Homework Parent

      --register
      --status
      --enable-homework --reason TEXT
      --disable-homework --reason TEXT
      --replace-policy --reason TEXT --blocked-bundle-id ID [--blocked-bundle-id ID ...]
      --unregister

    Registration must run from the signed parent app in /Applications. Homework-
    mode changes display the native macOS administrator authorization prompt.
    """)
  }
}
