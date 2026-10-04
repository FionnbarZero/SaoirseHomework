import Foundation

public enum GuardianAuditOperation: String, Codable, Equatable, Sendable {
  case beginChildSession
  case completeChildSession
  case replacePolicy
  case setHomeworkMode
}

public struct GuardianActiveChildSessionRecord: Codable, Equatable, Sendable {
  public let status: GuardianChildSessionStatus
  public let completionCapability: String

  public init(status: GuardianChildSessionStatus, completionCapability: String) {
    self.status = status
    self.completionCapability = completionCapability
  }

  public var grant: GuardianChildSessionGrant {
    GuardianChildSessionGrant(session: status, completionCapability: completionCapability)
  }
}

public struct GuardianAuditEntry: Codable, Equatable, Sendable {
  public let requestID: UUID
  public let changedAt: Date
  public let operation: GuardianAuditOperation
  public let homeworkMode: Bool?
  public let policyRevision: Int?
  public let blockedBundleIdentifiers: [String]?
  public let guardianSessionID: UUID?
  public let serviceSessionID: UUID?
  public let childSessionOutcome: GuardianChildSessionOutcome?
  public let reason: String

  public init(
    requestID: UUID,
    changedAt: Date,
    operation: GuardianAuditOperation,
    homeworkMode: Bool? = nil,
    policyRevision: Int? = nil,
    blockedBundleIdentifiers: [String]? = nil,
    guardianSessionID: UUID? = nil,
    serviceSessionID: UUID? = nil,
    childSessionOutcome: GuardianChildSessionOutcome? = nil,
    reason: String
  ) {
    self.requestID = requestID
    self.changedAt = changedAt
    self.operation = operation
    self.homeworkMode = homeworkMode
    self.policyRevision = policyRevision
    self.blockedBundleIdentifiers = blockedBundleIdentifiers
    self.guardianSessionID = guardianSessionID
    self.serviceSessionID = serviceSessionID
    self.childSessionOutcome = childSessionOutcome
    self.reason = reason
  }

  private enum CodingKeys: String, CodingKey {
    case requestID
    case changedAt
    case operation
    case homeworkMode
    case policyRevision
    case blockedBundleIdentifiers
    case guardianSessionID
    case serviceSessionID
    case childSessionOutcome
    case reason
  }

  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    requestID = try values.decode(UUID.self, forKey: .requestID)
    changedAt = try values.decode(Date.self, forKey: .changedAt)
    operation = try values.decodeIfPresent(GuardianAuditOperation.self, forKey: .operation)
      ?? .setHomeworkMode
    homeworkMode = try values.decodeIfPresent(Bool.self, forKey: .homeworkMode)
    policyRevision = try values.decodeIfPresent(Int.self, forKey: .policyRevision)
    blockedBundleIdentifiers = try values.decodeIfPresent(
      [String].self,
      forKey: .blockedBundleIdentifiers
    )
    guardianSessionID = try values.decodeIfPresent(UUID.self, forKey: .guardianSessionID)
    serviceSessionID = try values.decodeIfPresent(UUID.self, forKey: .serviceSessionID)
    childSessionOutcome = try values.decodeIfPresent(
      GuardianChildSessionOutcome.self,
      forKey: .childSessionOutcome
    )
    reason = try values.decode(String.self, forKey: .reason)
  }
}

public enum GuardianChildSessionError: Error, LocalizedError, Equatable {
  case activeSessionMismatch
  case completionCapabilityDenied
  case completionProofMismatch
  case sessionAlreadyClosed

  public var errorDescription: String? {
    switch self {
    case .activeSessionMismatch:
      "The completion grant does not match the active child session."
    case .completionCapabilityDenied:
      "The child-session completion capability was rejected."
    case .completionProofMismatch:
      "The completion proof does not match the active child session."
    case .sessionAlreadyClosed:
      "That child session was already closed and cannot be started again."
    }
  }
}

public struct GuardianDaemonState: Codable, Equatable, Sendable {
  public var homeworkMode: Bool
  public var policy: GuardianPolicy
  public var activeChildSession: GuardianActiveChildSessionRecord?
  public var lastClosedChildSession: GuardianClosedChildSessionStatus?
  public var closedServiceSessionIDs: [UUID]
  public var lastChangedAt: Date?
  public var processedRequestIDs: [UUID]
  public var auditLog: [GuardianAuditEntry]

  public init(
    homeworkMode: Bool = false,
    policy: GuardianPolicy = .safeDefault,
    activeChildSession: GuardianActiveChildSessionRecord? = nil,
    lastClosedChildSession: GuardianClosedChildSessionStatus? = nil,
    closedServiceSessionIDs: [UUID] = [],
    lastChangedAt: Date? = nil,
    processedRequestIDs: [UUID] = [],
    auditLog: [GuardianAuditEntry] = []
  ) {
    self.homeworkMode = homeworkMode
    self.policy = policy
    self.activeChildSession = activeChildSession
    self.lastClosedChildSession = lastClosedChildSession
    self.closedServiceSessionIDs = closedServiceSessionIDs
    self.lastChangedAt = lastChangedAt
    self.processedRequestIDs = processedRequestIDs
    self.auditLog = auditLog
  }

  private enum CodingKeys: String, CodingKey {
    case homeworkMode
    case policy
    case activeChildSession
    case lastClosedChildSession
    case closedServiceSessionIDs
    case lastChangedAt
    case processedRequestIDs
    case auditLog
  }

  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    homeworkMode = try values.decodeIfPresent(Bool.self, forKey: .homeworkMode) ?? false
    policy = try values.decodeIfPresent(GuardianPolicy.self, forKey: .policy) ?? .safeDefault
    activeChildSession = try values.decodeIfPresent(
      GuardianActiveChildSessionRecord.self,
      forKey: .activeChildSession
    )
    lastClosedChildSession = try values.decodeIfPresent(
      GuardianClosedChildSessionStatus.self,
      forKey: .lastClosedChildSession
    )
    closedServiceSessionIDs = try values.decodeIfPresent(
      [UUID].self,
      forKey: .closedServiceSessionIDs
    ) ?? []
    lastChangedAt = try values.decodeIfPresent(Date.self, forKey: .lastChangedAt)
    processedRequestIDs = try values.decodeIfPresent([UUID].self, forKey: .processedRequestIDs) ?? []
    auditLog = try values.decodeIfPresent([GuardianAuditEntry].self, forKey: .auditLog) ?? []
  }

  public var status: GuardianDaemonStatus {
    GuardianDaemonStatus(
      homeworkMode: homeworkMode,
      policy: policy,
      activeChildSession: activeChildSession?.status,
      lastClosedChildSession: lastClosedChildSession,
      lastChangedAt: lastChangedAt,
      lastRequestID: processedRequestIDs.last
    )
  }

  public func evaluate(
    _ request: GuardianApplicationEvaluationRequest,
    now: Date = Date()
  ) throws -> GuardianApplicationDecision {
    try GuardianRequestValidator.validate(request, now: now)
    guard homeworkMode else { return .inactive }
    guard let identifier = request.activeBundleIdentifier else { return .unavailable }
    return policy.blockedBundleIdentifiers.contains(identifier) ? .blocked : .allowed
  }

  @discardableResult
  public mutating func beginChildSession(
    _ request: GuardianBeginChildSessionRequest,
    guardianSessionID: UUID,
    completionCapability: String,
    now: Date = Date(),
    replayWindow: Int = 256
  ) throws -> GuardianChildSessionGrant {
    try GuardianRequestValidator.validate(
      request,
      now: now,
      processedRequestIDs: Set(processedRequestIDs)
    )
    if activeChildSession?.status.serviceSessionID == request.serviceSessionID,
       let activeChildSession {
      guard activeChildSession.status.weekID == request.weekID,
            activeChildSession.status.day == request.day else {
        throw GuardianChildSessionError.activeSessionMismatch
      }
      return activeChildSession.grant
    }
    guard !closedServiceSessionIDs.contains(request.serviceSessionID) else {
      throw GuardianChildSessionError.sessionAlreadyClosed
    }
    if activeChildSession != nil {
      closeActiveChildSession(outcome: .superseded, now: now, replayWindow: replayWindow)
    }

    let session = GuardianChildSessionStatus(
      guardianSessionID: guardianSessionID,
      serviceSessionID: request.serviceSessionID,
      weekID: request.weekID,
      day: request.day,
      startedAt: now
    )
    let activeRecord = GuardianActiveChildSessionRecord(
      status: session,
      completionCapability: completionCapability
    )
    activeChildSession = activeRecord
    homeworkMode = true
    lastChangedAt = now
    record(
      requestID: request.requestID,
      entry: GuardianAuditEntry(
        requestID: request.requestID,
        changedAt: now,
        operation: .beginChildSession,
        homeworkMode: true,
        guardianSessionID: guardianSessionID,
        serviceSessionID: request.serviceSessionID,
        reason: "Child entered Homework mode"
      ),
      replayWindow: replayWindow
    )
    return activeRecord.grant
  }

  @discardableResult
  public mutating func completeChildSession(
    _ request: GuardianCompleteChildSessionRequest,
    now: Date = Date(),
    replayWindow: Int = 256
  ) throws -> GuardianDaemonStatus {
    try GuardianRequestValidator.validate(
      request,
      now: now,
      processedRequestIDs: Set(processedRequestIDs)
    )
    guard let activeChildSession,
          activeChildSession.status.guardianSessionID == request.guardianSessionID,
          activeChildSession.status.serviceSessionID == request.proof.serviceSessionID else {
      throw GuardianChildSessionError.activeSessionMismatch
    }
    guard activeChildSession.completionCapability == request.completionCapability else {
      throw GuardianChildSessionError.completionCapabilityDenied
    }
    guard activeChildSession.status.weekID == request.proof.weekID,
          activeChildSession.status.day == request.proof.day else {
      throw GuardianChildSessionError.completionProofMismatch
    }

    let closed = closeActiveChildSession(
      outcome: .completed,
      now: now,
      replayWindow: replayWindow
    )
    homeworkMode = false
    lastChangedAt = now
    record(
      requestID: request.requestID,
      entry: GuardianAuditEntry(
        requestID: request.requestID,
        changedAt: now,
        operation: .completeChildSession,
        homeworkMode: false,
        guardianSessionID: closed?.guardianSessionID,
        serviceSessionID: closed?.serviceSessionID,
        childSessionOutcome: .completed,
        reason: "Local service verified the daily requirements"
      ),
      replayWindow: replayWindow
    )
    return status
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
    let closed = request.enabled
      ? nil
      : closeActiveChildSession(outcome: .parentOverride, now: now, replayWindow: replayWindow)
    homeworkMode = request.enabled
    lastChangedAt = now
    record(
      requestID: request.requestID,
      entry: GuardianAuditEntry(
        requestID: request.requestID,
        changedAt: now,
        operation: .setHomeworkMode,
        homeworkMode: request.enabled,
        guardianSessionID: closed?.guardianSessionID,
        serviceSessionID: closed?.serviceSessionID,
        childSessionOutcome: closed == nil ? nil : .parentOverride,
        reason: request.auditReason.trimmingCharacters(in: .whitespacesAndNewlines)
      ),
      replayWindow: replayWindow
    )
    return status
  }

  @discardableResult
  public mutating func apply(
    _ request: GuardianReplacePolicyRequest,
    now: Date = Date(),
    replayWindow: Int = 256
  ) throws -> GuardianDaemonStatus {
    try GuardianRequestValidator.validate(
      request,
      now: now,
      processedRequestIDs: Set(processedRequestIDs)
    )
    guard policy.revision < Int.max else {
      throw GuardianRequestValidationError.invalidPolicyRevision(policy.revision)
    }
    policy = GuardianPolicy(
      revision: policy.revision + 1,
      blockedBundleIdentifiers: request.blockedBundleIdentifiers.sorted()
    )
    lastChangedAt = now
    record(
      requestID: request.requestID,
      entry: GuardianAuditEntry(
        requestID: request.requestID,
        changedAt: now,
        operation: .replacePolicy,
        policyRevision: policy.revision,
        blockedBundleIdentifiers: policy.blockedBundleIdentifiers,
        reason: request.auditReason.trimmingCharacters(in: .whitespacesAndNewlines)
      ),
      replayWindow: replayWindow
    )
    return status
  }

  private mutating func record(
    requestID: UUID,
    entry: GuardianAuditEntry,
    replayWindow: Int
  ) {
    let capacity = max(1, replayWindow)
    processedRequestIDs.append(requestID)
    auditLog.append(entry)
    if processedRequestIDs.count > capacity {
      processedRequestIDs.removeFirst(processedRequestIDs.count - capacity)
    }
    if auditLog.count > capacity {
      auditLog.removeFirst(auditLog.count - capacity)
    }
  }

  @discardableResult
  private mutating func closeActiveChildSession(
    outcome: GuardianChildSessionOutcome,
    now: Date,
    replayWindow: Int
  ) -> GuardianClosedChildSessionStatus? {
    guard let activeChildSession else { return nil }
    let closed = GuardianClosedChildSessionStatus(
      guardianSessionID: activeChildSession.status.guardianSessionID,
      serviceSessionID: activeChildSession.status.serviceSessionID,
      outcome: outcome,
      closedAt: now
    )
    self.activeChildSession = nil
    lastClosedChildSession = closed
    closedServiceSessionIDs.append(closed.serviceSessionID)
    let capacity = max(1, replayWindow)
    if closedServiceSessionIDs.count > capacity {
      closedServiceSessionIDs.removeFirst(closedServiceSessionIDs.count - capacity)
    }
    return closed
  }
}
