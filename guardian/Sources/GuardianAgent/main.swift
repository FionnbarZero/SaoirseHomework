import Foundation
import GuardianXPC

@main
private struct GuardianAgentApplication {
  static func main() {
    do {
      let identity = try GuardianCurrentCodeSignature.identity()
      guard identity.bundleIdentifier == GuardianConstants.agentBundleIdentifier else {
        throw AgentError.incorrectCodeIdentity(identity.bundleIdentifier)
      }
      let once = CommandLine.arguments.dropFirst().contains("--once")
      repeat {
        let response = try GuardianDaemonClient().fetchStatus()
        guard response.success, let status = response.status else {
          throw AgentError.daemonRejected(response.message)
        }
        print("[agent] homework=\(status.homeworkMode ? "on" : "off") protocol=\(status.protocolVersion) service=\(status.serviceVersion)")
        if !once { Thread.sleep(forTimeInterval: 5) }
      } while !once
    } catch {
      fputs("guardian-agent: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}

private enum AgentError: Error, LocalizedError {
  case daemonRejected(String)
  case incorrectCodeIdentity(String)

  var errorDescription: String? {
    switch self {
    case .daemonRejected(let message): "The guardian daemon rejected the agent: \(message)"
    case .incorrectCodeIdentity(let identifier):
      "The guardian agent has the wrong signing identifier: \(identifier)."
    }
  }
}
