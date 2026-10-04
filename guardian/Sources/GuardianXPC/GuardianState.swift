import Foundation

public struct GuardianAuditEntry: Codable, Equatable, Sendable {
  public let requestID: UUID
  public let changedAt: Date
  public let homeworkMode: Bool
  public let reason: String

  public init(requestID: UUID, changedAt: Date, homeworkMode: Bool, reason: String) {
    self.requestID = requestID
    self.changedAt = changedAt
    self.homeworkMode = homeworkMode
    self.reason = reason
  }
}

public struct GuardianDaemonState: Codable, Equatable, Sendable {
  public var homeworkMode: Bool
  public var lastChangedAt: Date?
  public var processedRequestIDs: [UUID]
  public var auditLog: [GuardianAuditEntry]

  public init(
    homeworkMode: Bool = false,
    lastChangedAt: Date? = nil,
    processedRequestIDs: [UUID] = [],
    auditLog: [GuardianAuditEntry] = []
  ) {
    self.homeworkMode = homeworkMode
    self.lastChangedAt = lastChangedAt
    self.processedRequestIDs = processedRequestIDs
    self.auditLog = auditLog
  }

  public var status: GuardianDaemonStatus {
    GuardianDaemonStatus(
      homeworkMode: homeworkMode,
      lastChangedAt: lastChangedAt,
      lastRequestID: processedRequestIDs.last
    )
  }

  @discardableResult
  public mutating func apply(
    _ request: GuardianSetHomeworkModeRequest,
    now: Date = Date(),
    replayWindow: Int = 256
  ) throws -> GuardianDaemonStatus {
    try GuardianRequestValidator.validate(
      request,
      now: now,
      processedRequestIDs: Set(processedRequestIDs)
    )
    homeworkMode = request.enabled
    lastChangedAt = now
    processedRequestIDs.append(request.requestID)
    auditLog.append(GuardianAuditEntry(
      requestID: request.requestID,
      changedAt: now,
      homeworkMode: request.enabled,
      reason: request.auditReason.trimmingCharacters(in: .whitespacesAndNewlines)
    ))
    if processedRequestIDs.count > replayWindow {
      processedRequestIDs.removeFirst(processedRequestIDs.count - replayWindow)
    }
    if auditLog.count > replayWindow {
      auditLog.removeFirst(auditLog.count - replayWindow)
    }
    return status
  }
}
