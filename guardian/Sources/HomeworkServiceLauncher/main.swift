import Darwin
import Foundation
import GuardianXPC

private let lifecycleKeyURL = URL(fileURLWithPath: GuardianConstants.lifecycleKeyPath)
private let serviceDataURL = URL(fileURLWithPath: GuardianConstants.serviceDataPath)

@main
private struct HomeworkServiceLauncherApplication {
  static func main() {
    do {
      guard geteuid() == 0 else { throw ServiceLauncherError.requiresRoot }
      let identity = try GuardianCurrentCodeSignature.identity()
      guard identity.bundleIdentifier == GuardianConstants.serviceBundleIdentifier else {
        throw ServiceLauncherError.incorrectCodeIdentity(identity.bundleIdentifier)
      }

      try prepareSecureDirectory(serviceDataURL)
      _ = try GuardianLifecycleKeyStore.loadOrCreate(at: lifecycleKeyURL)
      _ = umask(0o077)

      guard let resources = Bundle.main.resourceURL else {
        throw ServiceLauncherError.missingBundleResource("Contents/Resources")
      }
      let serviceRoot = resources.appendingPathComponent("HomeworkService", isDirectory: true)
      let script = serviceRoot.appendingPathComponent("server/index.mjs")
      let node = Bundle.main.bundleURL
        .appendingPathComponent("Contents/MacOS/homework-service-node")
      guard FileManager.default.isExecutableFile(atPath: node.path) else {
        throw ServiceLauncherError.missingBundleResource("homework-service-node")
      }
      guard FileManager.default.fileExists(atPath: script.path) else {
        throw ServiceLauncherError.missingBundleResource("HomeworkService/server/index.mjs")
      }

      setEnvironment("HOMEWORK_DATA_DIR", serviceDataURL.path)
      setEnvironment("HOMEWORK_LIFECYCLE_KEY_FILE", lifecycleKeyURL.path)
      setEnvironment("HOMEWORK_REQUIRE_ROOT_OWNERSHIP", "1")
      setEnvironment("HOMEWORK_SECURITY_MODE", "enforcing")
      setEnvironment("HOMEWORK_PORT", "4179")
      guard FileManager.default.changeCurrentDirectoryPath(serviceRoot.path) else {
        throw ServiceLauncherError.cannotEnterServiceDirectory
      }

      let arguments = [node.path, "--no-warnings", script.path]
      var pointers: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) }
      pointers.append(nil)
      defer { pointers.compactMap { $0 }.forEach { free($0) } }
      let result = pointers.withUnsafeMutableBufferPointer { buffer in
        execv(node.path, buffer.baseAddress)
      }
      throw ServiceLauncherError.execFailed(result == -1 ? errno : result)
    } catch {
      fputs("homework-service: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }

  private static func prepareSecureDirectory(_ url: URL) throws {
    try FileManager.default.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700, .ownerAccountID: 0, .groupOwnerAccountID: 0],
      ofItemAtPath: url.path
    )
  }

  private static func setEnvironment(_ name: String, _ value: String) {
    setenv(name, value, 1)
  }
}

private enum ServiceLauncherError: Error, LocalizedError {
  case cannotEnterServiceDirectory
  case execFailed(Int32)
  case incorrectCodeIdentity(String)
  case missingBundleResource(String)
  case requiresRoot

  var errorDescription: String? {
    switch self {
    case .cannotEnterServiceDirectory:
      "The protected service resource directory could not be opened."
    case .execFailed(let code):
      "The bundled homework service could not start (errno \(code))."
    case .incorrectCodeIdentity(let identifier):
      "The homework service has the wrong signing identifier: \(identifier)."
    case .missingBundleResource(let resource):
      "The protected service is missing bundle resource \(resource)."
    case .requiresRoot:
      "The protected homework service must be launched as root."
    }
  }
}
