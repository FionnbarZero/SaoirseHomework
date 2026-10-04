import Foundation

public enum GuardianConstants {
  public static let protocolVersion = 1
  public static let serviceVersion = "0.3.0"
  public static let parentBundleIdentifier = "com.fionnbar.homework.parent"
  public static let agentBundleIdentifier = "com.fionnbar.homework.guardian.agent"
  public static let daemonBundleIdentifier = "com.fionnbar.homework.guardian.daemon"
  public static let daemonMachService = "com.fionnbar.homework.guardian.daemon"
  public static let agentPlistName = "com.fionnbar.homework.guardian.agent.plist"
  public static let daemonPlistName = "com.fionnbar.homework.guardian.daemon.plist"
  public static let administratorRight = "system.privilege.admin"
  public static let authorizationExternalFormLength = 32
  public static let maximumRequestAge: TimeInterval = 30
}

@objc public protocol GuardianDaemonXPCProtocol {
  func fetchStatus(withReply reply: @escaping (Data) -> Void)
  func setHomeworkMode(
    _ encodedRequest: Data,
    authorizationExternalForm: Data,
    withReply reply: @escaping (Data) -> Void
  )
}

public struct GuardianDaemonStatus: Codable, Equatable, Sendable {
  public let protocolVersion: Int
  public let serviceVersion: String
  public let homeworkMode: Bool
  public let lastChangedAt: Date?
  public let lastRequestID: UUID?

  public init(
    protocolVersion: Int = GuardianConstants.protocolVersion,
    serviceVersion: String = GuardianConstants.serviceVersion,
    homeworkMode: Bool,
    lastChangedAt: Date? = nil,
    lastRequestID: UUID? = nil
  ) {
    self.protocolVersion = protocolVersion
    self.serviceVersion = serviceVersion
    self.homeworkMode = homeworkMode
    self.lastChangedAt = lastChangedAt
    self.lastRequestID = lastRequestID
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

public struct GuardianXPCReply: Codable, Equatable, Sendable {
  public let success: Bool
  public let status: GuardianDaemonStatus?
  public let errorCode: GuardianXPCErrorCode?
  public let message: String

  public init(
    success: Bool,
    status: GuardianDaemonStatus? = nil,
    errorCode: GuardianXPCErrorCode? = nil,
    message: String
  ) {
    self.success = success
    self.status = status
    self.errorCode = errorCode
    self.message = message
  }

  public static func accepted(status: GuardianDaemonStatus, message: String) -> GuardianXPCReply {
    GuardianXPCReply(success: true, status: status, message: message)
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
  case invalidRequest
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
  case duplicateRequest
  case invalidAuditReason
  case requestFromFuture
  case staleRequest
  case unsupportedProtocol(Int)

  public var errorDescription: String? {
    switch self {
    case .duplicateRequest:
      "The request has already been processed."
    case .invalidAuditReason:
      "An audit reason between 3 and 240 printable characters is required."
    case .requestFromFuture:
      "The request timestamp is too far in the future."
    case .staleRequest:
      "The authorization request has expired."
    case .unsupportedProtocol(let version):
      "Unsupported guardian protocol version: \(version)."
    }
  }
}

public enum GuardianRequestValidator {
  public static func validate(
    _ request: GuardianSetHomeworkModeRequest,
    now: Date = Date(),
    processedRequestIDs: Set<UUID> = []
  ) throws {
    guard request.protocolVersion == GuardianConstants.protocolVersion else {
      throw GuardianRequestValidationError.unsupportedProtocol(request.protocolVersion)
    }
    guard !processedRequestIDs.contains(request.requestID) else {
      throw GuardianRequestValidationError.duplicateRequest
    }

    let age = now.timeIntervalSince(request.requestedAt)
    guard age >= -5 else { throw GuardianRequestValidationError.requestFromFuture }
    guard age <= GuardianConstants.maximumRequestAge else {
      throw GuardianRequestValidationError.staleRequest
    }

    let reason = request.auditReason.trimmingCharacters(in: .whitespacesAndNewlines)
    let isPrintable = reason.unicodeScalars.allSatisfy {
      !CharacterSet.controlCharacters.contains($0)
    }
    guard (3...240).contains(reason.count), isPrintable else {
      throw GuardianRequestValidationError.invalidAuditReason
    }
  }
}
