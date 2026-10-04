import CryptoKit
import Darwin
import Foundation
import Security

public enum GuardianLifecycleMode: String, Codable, Equatable, Sendable {
  case inactive
  case homework
  case free
}

public struct GuardianLifecycleAssertion: Codable, Equatable, Sendable {
  public let version: Int
  public let issuedAtMilliseconds: Int64
  public let expiresAtMilliseconds: Int64
  public let mode: GuardianLifecycleMode
  public let serviceSessionId: UUID?
  public let weekId: String?
  public let day: String?
  public let eligibleAtMilliseconds: Int64?
  public let requiredCompleted: Int?
  public let requiredTarget: Int?
  public let optionalCompleted: Int?
  public let optionalTarget: Int?

  public init(
    version: Int = 1,
    issuedAtMilliseconds: Int64,
    expiresAtMilliseconds: Int64,
    mode: GuardianLifecycleMode,
    serviceSessionId: UUID?,
    weekId: String?,
    day: String?,
    eligibleAtMilliseconds: Int64?,
    requiredCompleted: Int?,
    requiredTarget: Int?,
    optionalCompleted: Int?,
    optionalTarget: Int?
  ) {
    self.version = version
    self.issuedAtMilliseconds = issuedAtMilliseconds
    self.expiresAtMilliseconds = expiresAtMilliseconds
    self.mode = mode
    self.serviceSessionId = serviceSessionId
    self.weekId = weekId
    self.day = day
    self.eligibleAtMilliseconds = eligibleAtMilliseconds
    self.requiredCompleted = requiredCompleted
    self.requiredTarget = requiredTarget
    self.optionalCompleted = optionalCompleted
    self.optionalTarget = optionalTarget
  }
}

public enum GuardianLifecycleAuthenticationError: Error, LocalizedError, Equatable {
  case assertionExpired
  case assertionFromFuture
  case invalidAssertion
  case invalidAuthenticationTag
  case invalidKey
  case invalidKeyFile
  case keyCreationFailed(Int32)
  case randomGenerationFailed(OSStatus)

  public var errorDescription: String? {
    switch self {
    case .assertionExpired:
      "The local-service lifecycle assertion has expired."
    case .assertionFromFuture:
      "The local-service lifecycle assertion is from the future."
    case .invalidAssertion:
      "The local-service lifecycle assertion is malformed."
    case .invalidAuthenticationTag:
      "The local-service lifecycle assertion could not be authenticated."
    case .invalidKey:
      "The lifecycle authentication key must contain exactly 32 bytes."
    case .invalidKeyFile:
      "The lifecycle authentication key file is not a secure root-owned file."
    case .keyCreationFailed(let code):
      "The lifecycle authentication key could not be created (errno \(code))."
    case .randomGenerationFailed(let status):
      "The lifecycle authentication key could not be generated (Security status \(status))."
    }
  }
}

public enum GuardianLifecycleAuthenticator {
  public static let assertionVersion = 1
  public static let maximumAssertionLifetimeMilliseconds: Int64 = 30_000

  public static func authenticationTag(for assertion: Data, key: Data) throws -> Data {
    guard key.count == 32 else { throw GuardianLifecycleAuthenticationError.invalidKey }
    return Data(HMAC<SHA256>.authenticationCode(
      for: assertion,
      using: SymmetricKey(data: key)
    ))
  }

  public static func authenticate(
    assertion: Data,
    authenticationTag: Data,
    key: Data,
    now: Date = Date()
  ) throws -> GuardianLifecycleAssertion {
    guard assertion.count <= 4_096 else {
      throw GuardianLifecycleAuthenticationError.invalidAssertion
    }
    let expected = try self.authenticationTag(for: assertion, key: key)
    guard constantTimeEqual(expected, authenticationTag) else {
      throw GuardianLifecycleAuthenticationError.invalidAuthenticationTag
    }
    let decoded: GuardianLifecycleAssertion
    do {
      decoded = try JSONDecoder().decode(GuardianLifecycleAssertion.self, from: assertion)
    } catch {
      throw GuardianLifecycleAuthenticationError.invalidAssertion
    }
    try validate(decoded, now: now)
    return decoded
  }

  private static func validate(_ assertion: GuardianLifecycleAssertion, now: Date) throws {
    guard assertion.version == assertionVersion else {
      throw GuardianLifecycleAuthenticationError.invalidAssertion
    }
    let nowMilliseconds = Int64((now.timeIntervalSince1970 * 1_000).rounded(.down))
    guard assertion.issuedAtMilliseconds <= nowMilliseconds + 5_000 else {
      throw GuardianLifecycleAuthenticationError.assertionFromFuture
    }
    guard assertion.expiresAtMilliseconds >= nowMilliseconds else {
      throw GuardianLifecycleAuthenticationError.assertionExpired
    }
    let lifetime = assertion.expiresAtMilliseconds - assertion.issuedAtMilliseconds
    guard (1...maximumAssertionLifetimeMilliseconds).contains(lifetime) else {
      throw GuardianLifecycleAuthenticationError.invalidAssertion
    }

    switch assertion.mode {
    case .inactive:
      guard assertion.serviceSessionId == nil,
            assertion.weekId == nil,
            assertion.day == nil,
            assertion.eligibleAtMilliseconds == nil,
            assertion.requiredCompleted == nil,
            assertion.requiredTarget == nil,
            assertion.optionalCompleted == nil,
            assertion.optionalTarget == nil else {
        throw GuardianLifecycleAuthenticationError.invalidAssertion
      }
    case .homework:
      guard assertion.serviceSessionId != nil,
            assertion.weekId != nil,
            assertion.day != nil,
            assertion.eligibleAtMilliseconds == nil,
            assertion.requiredCompleted == nil,
            assertion.requiredTarget == nil,
            assertion.optionalCompleted == nil,
            assertion.optionalTarget == nil else {
        throw GuardianLifecycleAuthenticationError.invalidAssertion
      }
    case .free:
      guard assertion.serviceSessionId != nil,
            assertion.weekId != nil,
            assertion.day != nil,
            let eligibleAt = assertion.eligibleAtMilliseconds,
            eligibleAt <= nowMilliseconds + 5_000,
            assertion.requiredCompleted != nil,
            assertion.requiredTarget != nil,
            assertion.optionalCompleted != nil,
            assertion.optionalTarget != nil else {
        throw GuardianLifecycleAuthenticationError.invalidAssertion
      }
    }
  }

  private static func constantTimeEqual(_ left: Data, _ right: Data) -> Bool {
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in left.indices {
      difference |= left[index] ^ right[index]
    }
    return difference == 0
  }
}

public enum GuardianLifecycleKeyStore {
  public static func loadOrCreate(at url: URL) throws -> Data {
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

    if FileManager.default.fileExists(atPath: url.path) {
      return try loadSecureKey(at: url)
    }

    var bytes = [UInt8](repeating: 0, count: 32)
    let randomStatus = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard randomStatus == errSecSuccess else {
      throw GuardianLifecycleAuthenticationError.randomGenerationFailed(randomStatus)
    }

    let descriptor = Darwin.open(
      url.path,
      O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
      mode_t(S_IRUSR | S_IWUSR)
    )
    if descriptor < 0 {
      if errno == EEXIST { return try loadSecureKey(at: url) }
      throw GuardianLifecycleAuthenticationError.keyCreationFailed(errno)
    }
    defer { Darwin.close(descriptor) }

    var written = 0
    while written < bytes.count {
      let count = bytes.withUnsafeBytes { buffer -> Int in
        guard let baseAddress = buffer.baseAddress else { return -1 }
        return Darwin.write(
          descriptor,
          baseAddress.advanced(by: written),
          bytes.count - written
        )
      }
      guard count > 0 else {
        throw GuardianLifecycleAuthenticationError.keyCreationFailed(errno)
      }
      written += count
    }
    guard Darwin.fsync(descriptor) == 0 else {
      throw GuardianLifecycleAuthenticationError.keyCreationFailed(errno)
    }
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600, .ownerAccountID: 0, .groupOwnerAccountID: 0],
      ofItemAtPath: url.path
    )
    return Data(bytes)
  }

  private static func loadSecureKey(at url: URL) throws -> Data {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          (attributes[.ownerAccountID] as? NSNumber)?.intValue == 0,
          let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue,
          permissions & 0o077 == 0 else {
      throw GuardianLifecycleAuthenticationError.invalidKeyFile
    }
    let key = try Data(contentsOf: url, options: [.mappedIfSafe, .uncached])
    guard key.count == 32 else { throw GuardianLifecycleAuthenticationError.invalidKeyFile }
    return key
  }
}
