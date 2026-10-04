import Foundation
import Security

public struct GuardianCodeIdentity: Equatable, Sendable {
  public let teamIdentifier: String
  public let bundleIdentifier: String

  public init(teamIdentifier: String, bundleIdentifier: String) {
    self.teamIdentifier = teamIdentifier
    self.bundleIdentifier = bundleIdentifier
  }
}

public enum GuardianCodeSigningError: Error, LocalizedError, Equatable {
  case invalidBundleIdentifier(String)
  case invalidTeamIdentifier(String)
  case signingInformationUnavailable(OSStatus)
  case unsignedProcess

  public var errorDescription: String? {
    switch self {
    case .invalidBundleIdentifier(let identifier):
      "Invalid bundle identifier in signing requirement: \(identifier)."
    case .invalidTeamIdentifier(let identifier):
      "Invalid Apple team identifier: \(identifier)."
    case .signingInformationUnavailable(let status):
      "Unable to read this process's code signature (OSStatus \(status))."
    case .unsignedProcess:
      "A non-ad-hoc Apple team signature is required."
    }
  }
}

public enum GuardianSigningRequirement {
  public static func make(teamIdentifier: String, allowedBundleIdentifiers: Set<String>) throws -> String {
    guard teamIdentifier.range(of: #"^[A-Z0-9]{10}$"#, options: .regularExpression) != nil else {
      throw GuardianCodeSigningError.invalidTeamIdentifier(teamIdentifier)
    }
    guard !allowedBundleIdentifiers.isEmpty else {
      throw GuardianCodeSigningError.invalidBundleIdentifier("")
    }

    let bundleIdentifiers = try allowedBundleIdentifiers.sorted().map { identifier -> String in
      guard identifier.range(
        of: #"^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$"#,
        options: .regularExpression
      ) != nil else {
        throw GuardianCodeSigningError.invalidBundleIdentifier(identifier)
      }
      return #"identifier "\#(identifier)""#
    }
    let identifierClause = bundleIdentifiers.count == 1
      ? bundleIdentifiers[0]
      : "(\(bundleIdentifiers.joined(separator: " or ")))"
    return #"anchor apple generic and certificate leaf[subject.OU] = "\#(teamIdentifier)" and \#(identifierClause)"#
  }
}

public enum GuardianCurrentCodeSignature {
  public static func identity() throws -> GuardianCodeIdentity {
    var staticCode: SecCode?
    let selfStatus = SecCodeCopySelf([], &staticCode)
    guard selfStatus == errSecSuccess, let staticCode else {
      throw GuardianCodeSigningError.signingInformationUnavailable(selfStatus)
    }

    var staticSigningCode: SecStaticCode?
    let staticStatus = SecCodeCopyStaticCode(staticCode, [], &staticSigningCode)
    guard staticStatus == errSecSuccess, let staticSigningCode else {
      throw GuardianCodeSigningError.signingInformationUnavailable(staticStatus)
    }

    var rawInformation: CFDictionary?
    let informationStatus = SecCodeCopySigningInformation(
      staticSigningCode,
      SecCSFlags(rawValue: kSecCSSigningInformation),
      &rawInformation
    )
    guard informationStatus == errSecSuccess,
          let information = rawInformation as? [String: Any],
          let teamIdentifier = information[kSecCodeInfoTeamIdentifier as String] as? String,
          let bundleIdentifier = information[kSecCodeInfoIdentifier as String] as? String,
          !teamIdentifier.isEmpty,
          !bundleIdentifier.isEmpty else {
      if informationStatus != errSecSuccess {
        throw GuardianCodeSigningError.signingInformationUnavailable(informationStatus)
      }
      throw GuardianCodeSigningError.unsignedProcess
    }
    return GuardianCodeIdentity(
      teamIdentifier: teamIdentifier,
      bundleIdentifier: bundleIdentifier
    )
  }

  public static func requirement(allowedBundleIdentifiers: Set<String>) throws -> String {
    let current = try identity()
    return try GuardianSigningRequirement.make(
      teamIdentifier: current.teamIdentifier,
      allowedBundleIdentifiers: allowedBundleIdentifiers
    )
  }
}
