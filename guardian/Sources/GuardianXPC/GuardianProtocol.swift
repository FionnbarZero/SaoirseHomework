import Foundation

public enum GuardianConstants {
  public static let protocolVersion = 6
  public static let serviceVersion = "0.8.0"
  public static let parentBundleIdentifier = "com.fionnbar.homework.parent"
  public static let agentBundleIdentifier = "com.fionnbar.homework.guardian.agent"
  public static let daemonBundleIdentifier = "com.fionnbar.homework.guardian.daemon"
  public static let serviceBundleIdentifier = "com.fionnbar.homework.service"
  public static let daemonMachService = "com.fionnbar.homework.guardian.daemon"
  public static let agentPlistName = "com.fionnbar.homework.guardian.agent.plist"
  public static let daemonPlistName = "com.fionnbar.homework.guardian.daemon.plist"
  public static let servicePlistName = "com.fionnbar.homework.service.plist"
  public static let lifecycleKeyPath = "/Library/Application Support/FionnbarHomework/Privileged/lifecycle-auth.key"
  public static let serviceDataPath = "/Library/Application Support/FionnbarHomework/Data"
  public static let administratorRight = "system.privilege.admin"
  public static let authorizationExternalFormLength = 32
  public static let maximumRequestAge: TimeInterval = 30
  public static let maximumPayloadBytes = 32_768
  public static let maximumBlockedBundleIdentifiers = 128
}

@objc public protocol GuardianDaemonXPCProtocol {
  func fetchStatus(withReply reply: @escaping (Data) -> Void)
  func evaluateApplication(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void)
  func beginChildSession(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void)
  func completeChildSession(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void)
  func issueServiceAccess(_ encodedRequest: Data, withReply reply: @escaping (Data) -> Void)
  func authorizeParentChallenge(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  )
  func setHomeworkMode(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  )
  func replacePolicy(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  )
}

public enum GuardianApplicationDecision: String, Codable, Equatable, Sendable {
  case inactive
  case allowed
  case blocked
  case unavailable
}

public struct GuardianPolicy: Codable, Equatable, Sendable {
  public let revision: Int
  public let blockedBundleIdentifiers: [String]

  public init(revision: Int, blockedBundleIdentifiers: [String]) {
    self.revision = revision
    self.blockedBundleIdentifiers = blockedBundleIdentifiers
  }

  public static let safeDefault = GuardianPolicy(
    revision: 1,
    blockedBundleIdentifiers: [
      "com.apple.Safari",
      "com.apple.Terminal",
      "com.roblox.Roblox",
    ]
  )
}

public enum GuardianChildSessionOutcome: String, Codable, Equatable, Sendable {
  case completed
  case parentOverride
  case superseded
}

public struct GuardianChildSessionStatus: Codable, Equatable, Sendable {
  public let guardianSessionID: UUID
  public let serviceSessionID: UUID
  public let weekID: String
  public let day: String
  public let startedAt: Date

  public init(
    guardianSessionID: UUID,
    serviceSessionID: UUID,
    weekID: String,
    day: String,
    startedAt: Date
  ) {
    self.guardianSessionID = guardianSessionID
    self.serviceSessionID = serviceSessionID
    self.weekID = weekID
    self.day = day
    self.startedAt = startedAt
  }
}

public struct GuardianClosedChildSessionStatus: Codable, Equatable, Sendable {
  public let guardianSessionID: UUID
  public let serviceSessionID: UUID
  public let outcome: GuardianChildSessionOutcome
  public let closedAt: Date

  public init(
    guardianSessionID: UUID,
    serviceSessionID: UUID,
    outcome: GuardianChildSessionOutcome,
    closedAt: Date
  ) {
    self.guardianSessionID = guardianSessionID
    self.serviceSessionID = serviceSessionID
    self.outcome = outcome
    self.closedAt = closedAt
  }
}

public struct GuardianChildSessionGrant: Codable, Equatable, Sendable {
  public let session: GuardianChildSessionStatus
  public let completionCapability: String

  public init(session: GuardianChildSessionStatus, completionCapability: String) {
    self.session = session
    self.completionCapability = completionCapability
  }
}

public struct GuardianDaemonStatus: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let serviceVersion: String
  public let homeworkMode: Bool
  public let policy: GuardianPolicy
  public let activeChildSession: GuardianChildSessionStatus?
  public let lastClosedChildSession: GuardianClosedChildSessionStatus?
  public let lastChangedAt: Date?
  public let lastRequestID: UUID?

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    serviceVersion: String = GuardianConstants.serviceVersion,
    homeworkMode: Bool,
    policy: GuardianPolicy = .safeDefault,
    activeChildSession: GuardianChildSessionStatus? = nil,
    lastClosedChildSession: GuardianClosedChildSessionStatus? = nil,
    lastChangedAt: Date? = nil,
    lastRequestID: UUID? = nil
  ) {
    self.protocolVersion = protocolVersion
    self.serviceVersion = serviceVersion
    self.homeworkMode = homeworkMode
    self.policy = policy
    self.activeChildSession = activeChildSession
    self.lastClosedChildSession = lastClosedChildSession
    self.lastChangedAt = lastChangedAt
    self.lastRequestID = lastRequestID
  }
}

public struct GuardianBeginChildSessionRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date
  public let serviceSessionID: UUID
  public let weekID: String
  public let day: String
  public let lifecycleAssertion: Data
  public let lifecycleAuthenticationTag: Data

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date(),
    serviceSessionID: UUID,
    weekID: String,
    day: String,
    lifecycleAssertion: Data = Data(),
    lifecycleAuthenticationTag: Data = Data()
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
    self.serviceSessionID = serviceSessionID
    self.weekID = weekID
    self.day = day
    self.lifecycleAssertion = lifecycleAssertion
    self.lifecycleAuthenticationTag = lifecycleAuthenticationTag
  }
}

public struct GuardianServiceCompletionProof: Codable, Equatable, Sendable {
  public let serviceSessionID: UUID
  public let weekID: String
  public let day: String
  public let eligibleAt: Date
  public let requiredCompleted: Int
  public let requiredTarget: Int
  public let optionalCompleted: Int
  public let optionalTarget: Int

  public init(
    serviceSessionID: UUID,
    weekID: String,
    day: String,
    eligibleAt: Date,
    requiredCompleted: Int,
    requiredTarget: Int,
    optionalCompleted: Int,
    optionalTarget: Int
  ) {
    self.serviceSessionID = serviceSessionID
    self.weekID = weekID
    self.day = day
    self.eligibleAt = eligibleAt
    self.requiredCompleted = requiredCompleted
    self.requiredTarget = requiredTarget
    self.optionalCompleted = optionalCompleted
    self.optionalTarget = optionalTarget
  }
}

public struct GuardianCompleteChildSessionRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date
  public let guardianSessionID: UUID
  public let completionCapability: String
  public let proof: GuardianServiceCompletionProof
  public let lifecycleAssertion: Data
  public let lifecycleAuthenticationTag: Data

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date(),
    guardianSessionID: UUID,
    completionCapability: String,
    proof: GuardianServiceCompletionProof,
    lifecycleAssertion: Data = Data(),
    lifecycleAuthenticationTag: Data = Data()
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
    self.guardianSessionID = guardianSessionID
    self.completionCapability = completionCapability
    self.proof = proof
    self.lifecycleAssertion = lifecycleAssertion
    self.lifecycleAuthenticationTag = lifecycleAuthenticationTag
  }
}

public struct GuardianSetHomeworkModeRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date
  public let enabled: Bool
  public let auditReason: String

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date(),
    enabled: Bool,
    auditReason: String
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
    self.enabled = enabled
    self.auditReason = auditReason
  }
}

public struct GuardianReplacePolicyRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date
  public let blockedBundleIdentifiers: [String]
  public let auditReason: String

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date(),
    blockedBundleIdentifiers: [String],
    auditReason: String
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
    self.blockedBundleIdentifiers = blockedBundleIdentifiers
    self.auditReason = auditReason
  }
}

public struct GuardianServiceAccessRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date()
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
  }
}

public struct GuardianParentChallengeAuthorizationRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let requestID: UUID
  public let requestedAt: Date
  public let challengeID: String
  public let purpose: String
  public let approved: Bool

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    requestID: UUID = UUID(),
    requestedAt: Date = Date(),
    challengeID: String,
    purpose: String,
    approved: Bool
  ) {
    self.protocolVersion = protocolVersion
    self.requestID = requestID
    self.requestedAt = requestedAt
    self.challengeID = challengeID
    self.purpose = purpose
    self.approved = approved
  }
}

public struct GuardianApplicationEvaluationRequest: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let observedAt: Date
  public let activeBundleIdentifier: String?

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    observedAt: Date = Date(),
    activeBundleIdentifier: String?
  ) {
    self.protocolVersion = protocolVersion
    self.observedAt = observedAt
    self.activeBundleIdentifier = activeBundleIdentifier
  }
}

public struct GuardianXPCReply: Codable, Equatable, Sendable {
  public let success: Bool
  public let status: GuardianDaemonStatus?
  public let decision: GuardianApplicationDecision?
  public let sessionGrant: GuardianChildSessionGrant?
  public let serviceAuthentication: GuardianServiceBrokerEnvelope?
  public let errorCode: GuardianXPCErrorCode?
  public let message: String

  public init(
    success: Bool,
    status: GuardianDaemonStatus? = nil,
    decision: GuardianApplicationDecision? = nil,
    sessionGrant: GuardianChildSessionGrant? = nil,
    serviceAuthentication: GuardianServiceBrokerEnvelope? = nil,
    errorCode: GuardianXPCErrorCode? = nil,
    message: String
  ) {
    self.success = success
    self.status = status
    self.decision = decision
    self.sessionGrant = sessionGrant
    self.serviceAuthentication = serviceAuthentication
    self.errorCode = errorCode
    self.message = message
  }

  public static func accepted(status: GuardianDaemonStatus, message: String) -> GuardianXPCReply {
    GuardianXPCReply(success: true, status: status, message: message)
  }

  public static func evaluated(
    status: GuardianDaemonStatus,
    decision: GuardianApplicationDecision
  ) -> GuardianXPCReply {
    GuardianXPCReply(
      success: true,
      status: status,
      decision: decision,
      message: "Application policy evaluated."
    )
  }

  public static func sessionStarted(
    status: GuardianDaemonStatus,
    grant: GuardianChildSessionGrant
  ) -> GuardianXPCReply {
    GuardianXPCReply(
      success: true,
      status: status,
      sessionGrant: grant,
      message: "Child Homework session is active."
    )
  }

  public static func serviceAuthenticated(
    _ authentication: GuardianServiceBrokerEnvelope,
    message: String
  ) -> GuardianXPCReply {
    GuardianXPCReply(
      success: true,
      serviceAuthentication: authentication,
      message: message
    )
  }

  public static func rejected(_ code: GuardianXPCErrorCode, message: String) -> GuardianXPCReply {
    GuardianXPCReply(success: false, errorCode: code, message: message)
  }
}

public enum GuardianXPCErrorCode: String, Codable, Equatable, Sendable {
  case authorizationDenied
  case duplicateRequest
  case internalFailure
  case invalidAuthorization
  case invalidParentChallenge
  case invalidRequest
  case lifecycleAuthenticationDenied
  case sessionCapabilityDenied
  case sessionClosed
  case sessionConflict
  case staleRequest
  case unsupportedProtocol
}

public enum GuardianWireCodec {
  public static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(value)
  }

  public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    return try decoder.decode(type, from: data)
  }
}

public enum GuardianRequestValidationError: Error, LocalizedError, Equatable {
  case duplicateBundleIdentifier(String)
  case duplicateRequest
  case invalidAuditReason
  case invalidBundleIdentifier(String)
  case invalidChildSessionDay(String)
  case invalidCompletionCapability
  case invalidCompletionProof
  case invalidPolicyRevision(Int)
  case invalidPolicySize(Int)
  case invalidParentChallenge
  case invalidWeekID(String)
  case payloadTooLarge(Int)
  case protectedBundleIdentifier(String)
  case requestFromFuture
  case staleRequest
  case unsupportedProtocol(Int)

  public var errorDescription: String? {
    switch self {
    case .duplicateBundleIdentifier(let identifier):
      "The policy repeats bundle identifier \(identifier)."
    case .duplicateRequest:
      "The request has already been processed."
    case .invalidAuditReason:
      "An audit reason between 3 and 240 printable characters is required."
    case .invalidBundleIdentifier(let identifier):
      "Invalid application bundle identifier: \(identifier)."
    case .invalidChildSessionDay(let day):
      "Invalid child-session day: \(day)."
    case .invalidCompletionCapability:
      "The child-session completion capability is malformed."
    case .invalidCompletionProof:
      "The local service did not prove that the active requirements are complete."
    case .invalidPolicyRevision(let revision):
      "Policy revision must be positive, not \(revision)."
    case .invalidPolicySize(let count):
      "A policy must contain between 1 and \(GuardianConstants.maximumBlockedBundleIdentifiers) blocked bundle identifiers, not \(count)."
    case .invalidParentChallenge:
      "The Parent authorization challenge is malformed."
    case .invalidWeekID(let weekID):
      "Invalid child-session week identifier: \(weekID)."
    case .payloadTooLarge(let count):
      "The XPC request exceeds the \(GuardianConstants.maximumPayloadBytes)-byte limit (\(count) bytes)."
    case .protectedBundleIdentifier(let identifier):
      "The policy cannot block required system component \(identifier)."
    case .requestFromFuture:
      "The request timestamp is too far in the future."
    case .staleRequest:
      "The request has expired."
    case .unsupportedProtocol(let version):
      "Unsupported guardian protocol version: \(version)."
    }
  }
}

public enum GuardianRequestValidator {
  public static let protectedBundleIdentifiers: Set<String> = [
    GuardianConstants.parentBundleIdentifier,
    GuardianConstants.agentBundleIdentifier,
    GuardianConstants.daemonBundleIdentifier,
    "com.apple.Dock",
    "com.apple.finder",
    "com.apple.loginwindow",
    "com.apple.systemuiserver",
  ]

  public static func validate(
    _ request: GuardianSetHomeworkModeRequest,
    now: Date = Date(),
    processedRequestIDs: Set<UUID> = []
  ) throws {
    try validatePrivilegedMetadata(
      protocolVersion: request.protocolVersion,
      requestID: request.requestID,
      requestedAt: request.requestedAt,
      auditReason: request.auditReason,
      now: now,
      processedRequestIDs: processedRequestIDs
    )
  }

  public static func validate(
    _ request: GuardianReplacePolicyRequest,
    now: Date = Date(),
    processedRequestIDs: Set<UUID> = []
  ) throws {
    try validatePrivilegedMetadata(
      protocolVersion: request.protocolVersion,
      requestID: request.requestID,
      requestedAt: request.requestedAt,
      auditReason: request.auditReason,
      now: now,
      processedRequestIDs: processedRequestIDs
    )
    try validatePolicy(request.blockedBundleIdentifiers)
  }

  public static func validate(
    _ request: GuardianApplicationEvaluationRequest,
    now: Date = Date()
  ) throws {
    try validateProtocolAndDate(
      protocolVersion: request.protocolVersion,
      requestedAt: request.observedAt,
      now: now
    )
    if let identifier = request.activeBundleIdentifier {
      try validateBundleIdentifier(identifier)
    }
  }

  public static func validate(
    _ request: GuardianBeginChildSessionRequest,
    now: Date = Date(),
    processedRequestIDs: Set<UUID> = []
  ) throws {
    try validateLifecycleMetadata(
      protocolVersion: request.protocolVersion,
      requestID: request.requestID,
      requestedAt: request.requestedAt,
      now: now,
      processedRequestIDs: processedRequestIDs
    )
    try validateWeekAndDay(weekID: request.weekID, day: request.day)
  }

  public static func validate(
    _ request: GuardianCompleteChildSessionRequest,
    now: Date = Date(),
    processedRequestIDs: Set<UUID> = []
  ) throws {
    try validateLifecycleMetadata(
      protocolVersion: request.protocolVersion,
      requestID: request.requestID,
      requestedAt: request.requestedAt,
      now: now,
      processedRequestIDs: processedRequestIDs
    )
    guard request.completionCapability.range(
      of: #"^[A-Za-z0-9_-]{40,128}$"#,
      options: .regularExpression
    ) != nil else {
      throw GuardianRequestValidationError.invalidCompletionCapability
    }
    try validateWeekAndDay(weekID: request.proof.weekID, day: request.proof.day)
    let optionalTargets = [
      "Monday": 2,
      "Tuesday": 4,
      "Wednesday": 6,
      "Thursday": 8,
      "Friday": 9,
    ]
    guard let expectedOptionalTarget = optionalTargets[request.proof.day] else {
      throw GuardianRequestValidationError.invalidCompletionProof
    }
    guard request.proof.eligibleAt <= now.addingTimeInterval(5),
          request.proof.requiredTarget == 7,
          request.proof.requiredCompleted == request.proof.requiredTarget,
          request.proof.optionalTarget == expectedOptionalTarget,
          request.proof.optionalCompleted >= request.proof.optionalTarget,
          request.proof.optionalCompleted <= 9 else {
      throw GuardianRequestValidationError.invalidCompletionProof
    }
  }

  public static func validate(
    _ request: GuardianServiceAccessRequest,
    now: Date = Date()
  ) throws {
    try validateProtocolAndDate(
      protocolVersion: request.protocolVersion,
      requestedAt: request.requestedAt,
      now: now
    )
  }

  public static func validate(
    _ request: GuardianParentChallengeAuthorizationRequest,
    now: Date = Date()
  ) throws {
    try validateProtocolAndDate(
      protocolVersion: request.protocolVersion,
      requestedAt: request.requestedAt,
      now: now
    )
    let printable = request.challengeID.unicodeScalars.allSatisfy {
      !CharacterSet.controlCharacters.contains($0)
    }
    guard (3...256).contains(request.challengeID.count),
          printable,
          ["dashboard", "sensitive"].contains(request.purpose) else {
      throw GuardianRequestValidationError.invalidParentChallenge
    }
  }

  public static func validatePolicy(_ identifiers: [String]) throws {
    guard (1...GuardianConstants.maximumBlockedBundleIdentifiers).contains(identifiers.count) else {
      throw GuardianRequestValidationError.invalidPolicySize(identifiers.count)
    }
    var seen: Set<String> = []
    for identifier in identifiers {
      try validateBundleIdentifier(identifier)
      guard !protectedBundleIdentifiers.contains(identifier) else {
        throw GuardianRequestValidationError.protectedBundleIdentifier(identifier)
      }
      guard seen.insert(identifier).inserted else {
        throw GuardianRequestValidationError.duplicateBundleIdentifier(identifier)
      }
    }
  }

  public static func validatePolicy(_ policy: GuardianPolicy) throws {
    guard policy.revision > 0 else {
      throw GuardianRequestValidationError.invalidPolicyRevision(policy.revision)
    }
    try validatePolicy(policy.blockedBundleIdentifiers)
  }

  public static func validateBundleIdentifier(_ identifier: String) throws {
    guard identifier.count <= 128,
          identifier.range(
            of: #"^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$"#,
            options: .regularExpression
          ) != nil else {
      throw GuardianRequestValidationError.invalidBundleIdentifier(identifier)
    }
  }

  private static func validatePrivilegedMetadata(
    protocolVersion: Int,
    requestID: UUID,
    requestedAt: Date,
    auditReason: String,
    now: Date,
    processedRequestIDs: Set<UUID>
  ) throws {
    try validateProtocolAndDate(
      protocolVersion: protocolVersion,
      requestedAt: requestedAt,
      now: now
    )
    guard !processedRequestIDs.contains(requestID) else {
      throw GuardianRequestValidationError.duplicateRequest
    }
    let reason = auditReason.trimmingCharacters(in: .whitespacesAndNewlines)
    let isPrintable = reason.unicodeScalars.allSatisfy {
      !CharacterSet.controlCharacters.contains($0)
    }
    guard (3...240).contains(reason.count), isPrintable else {
      throw GuardianRequestValidationError.invalidAuditReason
    }
  }

  private static func validateLifecycleMetadata(
    protocolVersion: Int,
    requestID: UUID,
    requestedAt: Date,
    now: Date,
    processedRequestIDs: Set<UUID>
  ) throws {
    try validateProtocolAndDate(
      protocolVersion: protocolVersion,
      requestedAt: requestedAt,
      now: now
    )
    guard !processedRequestIDs.contains(requestID) else {
      throw GuardianRequestValidationError.duplicateRequest
    }
  }

  private static func validateWeekAndDay(weekID: String, day: String) throws {
    guard weekID.range(
      of: #"^\d{4}-\d{2}-\d{2}$"#,
      options: .regularExpression
    ) != nil else {
      throw GuardianRequestValidationError.invalidWeekID(weekID)
    }
    let days: Set<String> = [
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]
    guard days.contains(day) else {
      throw GuardianRequestValidationError.invalidChildSessionDay(day)
    }
  }

  private static func validateProtocolAndDate(
    protocolVersion: Int,
    requestedAt: Date,
    now: Date
  ) throws {
    guard protocolVersion == GuardianConstants.protocolVersion else {
      throw GuardianRequestValidationError.unsupportedProtocol(protocolVersion)
    }
    let age = now.timeIntervalSince(requestedAt)
    guard age >= -5 else { throw GuardianRequestValidationError.requestFromFuture }
    guard age <= GuardianConstants.maximumRequestAge else {
      throw GuardianRequestValidationError.staleRequest
    }
  }
}
