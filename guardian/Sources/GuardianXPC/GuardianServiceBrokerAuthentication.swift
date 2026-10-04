import Foundation

public struct GuardianServiceBrokerEnvelope: Codable, Equatable, Sendable {
  public let assertion: Data
  public let authenticationTag: Data
  public let expiresAt: Date

  public init(assertion: Data, authenticationTag: Data, expiresAt: Date) {
    self.assertion = assertion
    self.authenticationTag = authenticationTag
    self.expiresAt = expiresAt
  }

  public var bearerCredential: String {
    "\(assertion.base64URLEncodedString()).\(authenticationTag.base64URLEncodedString())"
  }
}

public struct GuardianServiceAccessAssertion: Codable, Equatable, Sendable {
  public let version: Int
  public let type: String
  public let issuedAtMilliseconds: Int64
  public let expiresAtMilliseconds: Int64
  public let subject: String
  public let audience: String
  public let permissions: [String]
  public let nonce: String
}

public struct GuardianParentAuthorizationAssertion: Codable, Equatable, Sendable {
  public let version: Int
  public let type: String
  public let issuedAtMilliseconds: Int64
  public let expiresAtMilliseconds: Int64
  public let challengeId: String
  public let purpose: String
  public let approved: Bool
}

public enum GuardianServiceBrokerAuthenticationError: Error, LocalizedError, Equatable {
  case expired
  case fromFuture
  case invalidAssertion
  case invalidAuthenticationTag

  public var errorDescription: String? {
    switch self {
    case .expired: "The user-session broker assertion has expired."
    case .fromFuture: "The user-session broker assertion is from the future."
    case .invalidAssertion: "The user-session broker assertion is malformed."
    case .invalidAuthenticationTag: "The user-session broker assertion could not be authenticated."
    }
  }
}

public enum GuardianServiceBrokerAuthenticator {
  public static let assertionVersion = 1
  public static let lifetime: TimeInterval = 15

  public static func serviceAccess(
    key: Data,
    now: Date = Date(),
    nonce: UUID = UUID()
  ) throws -> GuardianServiceBrokerEnvelope {
    let issued = milliseconds(now)
    let expires = milliseconds(now.addingTimeInterval(lifetime))
    let claim = GuardianServiceAccessAssertion(
      version: assertionVersion,
      type: "agent-access",
      issuedAtMilliseconds: issued,
      expiresAtMilliseconds: expires,
      subject: "guardian-agent",
      audience: "homework-service",
      permissions: ["broker.read", "broker.complete"],
      nonce: nonce.uuidString.lowercased()
    )
    return try envelope(for: claim, expiresAt: now.addingTimeInterval(lifetime), key: key)
  }

  public static func parentAuthorization(
    challengeID: String,
    purpose: String,
    approved: Bool,
    key: Data,
    now: Date = Date()
  ) throws -> GuardianServiceBrokerEnvelope {
    let claim = GuardianParentAuthorizationAssertion(
      version: assertionVersion,
      type: "parent-authorization",
      issuedAtMilliseconds: milliseconds(now),
      expiresAtMilliseconds: milliseconds(now.addingTimeInterval(lifetime)),
      challengeId: challengeID,
      purpose: purpose,
      approved: approved
    )
    return try envelope(for: claim, expiresAt: now.addingTimeInterval(lifetime), key: key)
  }

  public static func authenticateServiceAccess(
    _ envelope: GuardianServiceBrokerEnvelope,
    key: Data,
    now: Date = Date()
  ) throws -> GuardianServiceAccessAssertion {
    let claim: GuardianServiceAccessAssertion = try authenticate(
      envelope,
      as: GuardianServiceAccessAssertion.self,
      key: key,
      now: now
    )
    guard claim.type == "agent-access",
          claim.subject == "guardian-agent",
          claim.audience == "homework-service",
          claim.permissions.contains("broker.read"),
          claim.permissions.contains("broker.complete"),
          UUID(uuidString: claim.nonce) != nil else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    return claim
  }

  public static func authenticateParentAuthorization(
    _ envelope: GuardianServiceBrokerEnvelope,
    key: Data,
    now: Date = Date()
  ) throws -> GuardianParentAuthorizationAssertion {
    let claim: GuardianParentAuthorizationAssertion = try authenticate(
      envelope,
      as: GuardianParentAuthorizationAssertion.self,
      key: key,
      now: now
    )
    guard claim.type == "parent-authorization",
          (3...256).contains(claim.challengeId.count),
          ["dashboard", "sensitive"].contains(claim.purpose) else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    return claim
  }

  private static func envelope<T: Encodable>(
    for claim: T,
    expiresAt: Date,
    key: Data
  ) throws -> GuardianServiceBrokerEnvelope {
    let assertion = try GuardianWireCodec.encode(claim)
    let authenticationTag = try GuardianLifecycleAuthenticator.authenticationTag(
      for: assertion,
      key: key
    )
    return GuardianServiceBrokerEnvelope(
      assertion: assertion,
      authenticationTag: authenticationTag,
      expiresAt: expiresAt
    )
  }

  private static func authenticate<T: Decodable>(
    _ envelope: GuardianServiceBrokerEnvelope,
    as type: T.Type,
    key: Data,
    now: Date
  ) throws -> T {
    guard envelope.assertion.count <= 8_192 else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    let expected = try GuardianLifecycleAuthenticator.authenticationTag(
      for: envelope.assertion,
      key: key
    )
    guard constantTimeEqual(expected, envelope.authenticationTag) else {
      throw GuardianServiceBrokerAuthenticationError.invalidAuthenticationTag
    }
    let claim: T
    do {
      claim = try GuardianWireCodec.decode(type, from: envelope.assertion)
    } catch {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    let metadata: (version: Int, issued: Int64, expires: Int64)
    if let access = claim as? GuardianServiceAccessAssertion {
      metadata = (access.version, access.issuedAtMilliseconds, access.expiresAtMilliseconds)
    } else if let authorization = claim as? GuardianParentAuthorizationAssertion {
      metadata = (authorization.version, authorization.issuedAtMilliseconds, authorization.expiresAtMilliseconds)
    } else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    guard metadata.version == assertionVersion else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    let nowMilliseconds = milliseconds(now)
    guard metadata.issued <= nowMilliseconds + 5_000 else {
      throw GuardianServiceBrokerAuthenticationError.fromFuture
    }
    guard metadata.expires >= nowMilliseconds else {
      throw GuardianServiceBrokerAuthenticationError.expired
    }
    guard (1...30_000).contains(metadata.expires - metadata.issued) else {
      throw GuardianServiceBrokerAuthenticationError.invalidAssertion
    }
    return claim
  }

  private static func milliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
  }

  private static func constantTimeEqual(_ left: Data, _ right: Data) -> Bool {
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in left.indices { difference |= left[index] ^ right[index] }
    return difference == 0
  }
}

public extension Data {
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
