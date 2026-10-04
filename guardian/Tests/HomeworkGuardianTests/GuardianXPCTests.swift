import Foundation
import Testing
@testable import GuardianXPC

@Test func signingRequirementPinsTeamAndExactBundleIdentifiers() throws {
  let requirement = try GuardianSigningRequirement.make(
    teamIdentifier: "A1B2C3D4E5",
    allowedBundleIdentifiers: [
      GuardianConstants.parentBundleIdentifier,
      GuardianConstants.agentBundleIdentifier,
    ]
  )
  #expect(requirement == "anchor apple generic and certificate leaf[subject.OU] = \"A1B2C3D4E5\" and (identifier \"com.fionnbar.homework.guardian.agent\" or identifier \"com.fionnbar.homework.parent\")")
}

@Test func signingRequirementRejectsInjectedValues() {
  #expect(throws: GuardianCodeSigningError.invalidTeamIdentifier("TEAM or true")) {
    try GuardianSigningRequirement.make(
      teamIdentifier: "TEAM or true",
      allowedBundleIdentifiers: [GuardianConstants.parentBundleIdentifier]
    )
  }
  #expect(throws: GuardianCodeSigningError.invalidBundleIdentifier("com.fionnbar.parent\" or true")) {
    try GuardianSigningRequirement.make(
      teamIdentifier: "A1B2C3D4E5",
      allowedBundleIdentifiers: ["com.fionnbar.parent\" or true"]
    )
  }
}

@Test func privilegedRequestMustBeFreshUniqueAndAuditable() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let requestID = UUID(uuidString: "FFFFFFFF-1111-2222-3333-444444444444")!
  let request = GuardianSetHomeworkModeRequest(
    requestID: requestID,
    requestedAt: now.addingTimeInterval(-10),
    enabled: true,
    auditReason: "Starting the supervised homework session"
  )
  try GuardianRequestValidator.validate(request, now: now)

  #expect(throws: GuardianRequestValidationError.duplicateRequest) {
    try GuardianRequestValidator.validate(request, now: now, processedRequestIDs: [requestID])
  }
  let stale = GuardianSetHomeworkModeRequest(
    requestID: UUID(),
    requestedAt: now.addingTimeInterval(-31),
    enabled: false,
    auditReason: "Parent ended the session"
  )
  #expect(throws: GuardianRequestValidationError.staleRequest) {
    try GuardianRequestValidator.validate(stale, now: now)
  }
  let future = GuardianSetHomeworkModeRequest(
    requestID: UUID(),
    requestedAt: now.addingTimeInterval(6),
    enabled: true,
    auditReason: "Starting homework"
  )
  #expect(throws: GuardianRequestValidationError.requestFromFuture) {
    try GuardianRequestValidator.validate(future, now: now)
  }
}

@Test func privilegedRequestRejectsUnsupportedProtocolAndUnsafeReason() {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let wrongVersion = GuardianSetHomeworkModeRequest(
    protocolVersion: GuardianConstants.protocolVersion + 1,
    requestedAt: now,
    enabled: true,
    auditReason: "Starting homework"
  )
  #expect(throws: GuardianRequestValidationError.unsupportedProtocol(2)) {
    try GuardianRequestValidator.validate(wrongVersion, now: now)
  }
  let unsafeReason = GuardianSetHomeworkModeRequest(
    requestedAt: now,
    enabled: false,
    auditReason: "ok\nnot actually one audit line"
  )
  #expect(throws: GuardianRequestValidationError.invalidAuditReason) {
    try GuardianRequestValidator.validate(unsafeReason, now: now)
  }
}

@Test func daemonStatePersistsReplayProtectionWithinBoundedWindow() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let firstID = UUID(uuidString: "AAAAAAAA-1111-2222-3333-444444444444")!
  let first = GuardianSetHomeworkModeRequest(
    requestID: firstID,
    requestedAt: now,
    enabled: true,
    auditReason: "Start the homework session"
  )
  var state = GuardianDaemonState()
  let status = try state.apply(first, now: now, replayWindow: 2)
  #expect(status.homeworkMode)
  #expect(status.lastRequestID == firstID)
  #expect(state.auditLog.last?.reason == "Start the homework session")

  #expect(throws: GuardianRequestValidationError.duplicateRequest) {
    try state.apply(first, now: now, replayWindow: 2)
  }

  for enabled in [false, true] {
    let request = GuardianSetHomeworkModeRequest(
      requestedAt: now,
      enabled: enabled,
      auditReason: "Authorized parent mode change"
    )
    try state.apply(request, now: now, replayWindow: 2)
  }
  #expect(state.processedRequestIDs.count == 2)
  #expect(!state.processedRequestIDs.contains(firstID))
  #expect(state.auditLog.count == 2)
  #expect(state.auditLog.allSatisfy { $0.reason == "Authorized parent mode change" })
}

@Test func xpcWireFormatRoundTripsWithoutLosingFields() throws {
  let request = GuardianSetHomeworkModeRequest(
    requestID: UUID(uuidString: "BBBBBBBB-1111-2222-3333-444444444444")!,
    requestedAt: Date(timeIntervalSince1970: 1_800_000_000.125),
    enabled: true,
    auditReason: "Parent approved homework mode"
  )
  let encoded = try GuardianWireCodec.encode(request)
  let decoded = try GuardianWireCodec.decode(GuardianSetHomeworkModeRequest.self, from: encoded)
  #expect(decoded == request)
}

@Test func malformedAuthorizationReferenceIsRejectedBeforeValidation() {
  #expect(throws: GuardianAuthorizationError.invalidExternalFormLength(31)) {
    try GuardianAuthorization.validateAdministratorExternalForm(Data(repeating: 0, count: 31))
  }
}
