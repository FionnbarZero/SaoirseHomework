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
  #expect(throws: GuardianRequestValidationError.unsupportedProtocol(GuardianConstants.protocolVersion + 1)) {
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
  #expect(state.auditLog.allSatisfy { $0.operation == .setHomeworkMode })
}

@Test func daemonOwnsApplicationPolicyDecisions() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  var state = GuardianDaemonState()
  let safari = GuardianApplicationEvaluationRequest(
    observedAt: now,
    activeBundleIdentifier: "com.apple.Safari"
  )
  #expect(try state.evaluate(safari, now: now) == .inactive)

  try state.apply(GuardianSetHomeworkModeRequest(
    requestedAt: now,
    enabled: true,
    auditReason: "Begin policy decision test"
  ), now: now)
  #expect(try state.evaluate(safari, now: now) == .blocked)
  #expect(try state.evaluate(GuardianApplicationEvaluationRequest(
    observedAt: now,
    activeBundleIdentifier: "com.google.Chrome"
  ), now: now) == .allowed)
  #expect(try state.evaluate(GuardianApplicationEvaluationRequest(
    observedAt: now,
    activeBundleIdentifier: nil
  ), now: now) == .unavailable)
}

@Test func policyReplacementIsAuthorizedStateWithAuditAndReplayProtection() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let requestID = UUID(uuidString: "CCCCCCCC-1111-2222-3333-444444444444")!
  let request = GuardianReplacePolicyRequest(
    requestID: requestID,
    requestedAt: now,
    blockedBundleIdentifiers: ["com.roblox.Roblox", "com.apple.Safari"],
    auditReason: "Parent reviewed the blocked application list"
  )
  var state = GuardianDaemonState()
  let status = try state.apply(request, now: now)
  #expect(status.policy.revision == 2)
  #expect(status.policy.blockedBundleIdentifiers == ["com.apple.Safari", "com.roblox.Roblox"])
  #expect(state.auditLog.last?.operation == .replacePolicy)
  #expect(state.auditLog.last?.policyRevision == 2)
  #expect(state.auditLog.last?.blockedBundleIdentifiers == ["com.apple.Safari", "com.roblox.Roblox"])
  #expect(state.auditLog.last?.homeworkMode == nil)
  #expect(throws: GuardianRequestValidationError.duplicateRequest) {
    try state.apply(request, now: now)
  }
}

@Test func policyValidationRejectsEmptyDuplicateMalformedAndProtectedEntries() {
  #expect(throws: GuardianRequestValidationError.invalidPolicySize(0)) {
    try GuardianRequestValidator.validatePolicy([])
  }
  #expect(throws: GuardianRequestValidationError.invalidPolicyRevision(0)) {
    try GuardianRequestValidator.validatePolicy(GuardianPolicy(
      revision: 0,
      blockedBundleIdentifiers: ["com.apple.Safari"]
    ))
  }
  #expect(throws: GuardianRequestValidationError.duplicateBundleIdentifier("com.apple.Safari")) {
    try GuardianRequestValidator.validatePolicy(["com.apple.Safari", "com.apple.Safari"])
  }
  #expect(throws: GuardianRequestValidationError.invalidBundleIdentifier("Safari; rm")) {
    try GuardianRequestValidator.validatePolicy(["Safari; rm"])
  }
  #expect(throws: GuardianRequestValidationError.invalidBundleIdentifier("com..Safari")) {
    try GuardianRequestValidator.validatePolicy(["com..Safari"])
  }
  #expect(throws: GuardianRequestValidationError.protectedBundleIdentifier("com.apple.finder")) {
    try GuardianRequestValidator.validatePolicy(["com.apple.finder"])
  }
}

@Test func previousDaemonStateMigratesToTheSafeDefaultPolicy() throws {
  let priorState = Data("""
  {
    "homeworkMode": false,
    "lastChangedAt": 1800000000000,
    "processedRequestIDs": ["DDDDDDDD-1111-2222-3333-444444444444"],
    "auditLog": [{
      "requestID": "DDDDDDDD-1111-2222-3333-444444444444",
      "changedAt": 1800000000000,
      "homeworkMode": false,
      "reason": "Version 0.3 audit record"
    }]
  }
  """.utf8)
  let state = try GuardianWireCodec.decode(GuardianDaemonState.self, from: priorState)
  #expect(state.policy == .safeDefault)
  #expect(state.auditLog.first?.operation == .setHomeworkMode)
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

  let policy = GuardianReplacePolicyRequest(
    requestID: UUID(uuidString: "EEEEEEEE-1111-2222-3333-444444444444")!,
    requestedAt: Date(timeIntervalSince1970: 1_800_000_000.125),
    blockedBundleIdentifiers: ["com.apple.Safari", "com.roblox.Roblox"],
    auditReason: "Reviewed policy"
  )
  let encodedPolicy = try GuardianWireCodec.encode(policy)
  #expect(try GuardianWireCodec.decode(GuardianReplacePolicyRequest.self, from: encodedPolicy) == policy)

  let serviceSessionID = UUID(uuidString: "12345678-1234-4234-8234-123456789ABC")!
  let guardianSessionID = UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF")!
  let proof = GuardianServiceCompletionProof(
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Thursday",
    eligibleAt: Date(timeIntervalSince1970: 1_800_000_000),
    requiredCompleted: 5,
    requiredTarget: 5,
    optionalCompleted: 11,
    optionalTarget: 11
  )
  let completion = GuardianCompleteChildSessionRequest(
    requestID: UUID(uuidString: "99999999-1111-4222-8333-444444444444")!,
    requestedAt: Date(timeIntervalSince1970: 1_800_000_000),
    guardianSessionID: guardianSessionID,
    completionCapability: String(repeating: "G", count: 43),
    proof: proof
  )
  let encodedCompletion = try GuardianWireCodec.encode(completion)
  #expect(try GuardianWireCodec.decode(
    GuardianCompleteChildSessionRequest.self,
    from: encodedCompletion
  ) == completion)

  let session = GuardianChildSessionStatus(
    guardianSessionID: guardianSessionID,
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Thursday",
    startedAt: Date(timeIntervalSince1970: 1_800_000_000)
  )
  let reply = GuardianXPCReply.sessionStarted(
    status: GuardianDaemonStatus(homeworkMode: true, activeChildSession: session),
    grant: GuardianChildSessionGrant(
      session: session,
      completionCapability: String(repeating: "G", count: 43)
    )
  )
  let encodedReply = try GuardianWireCodec.encode(reply)
  #expect(try GuardianWireCodec.decode(GuardianXPCReply.self, from: encodedReply) == reply)
}

@Test func malformedAuthorizationReferenceIsRejectedBeforeValidation() {
  #expect(throws: GuardianAuthorizationError.invalidExternalFormLength(31)) {
    try GuardianAuthorization.validateAdministratorExternalForm(Data(repeating: 0, count: 31))
  }
}

@Test func childSessionGrantIsIdempotentAndVerifiedCompletionClosesIt() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let serviceSessionID = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
  let guardianSessionID = UUID(uuidString: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")!
  let capability = String(repeating: "A", count: 43)
  var state = GuardianDaemonState()

  let begin = GuardianBeginChildSessionRequest(
    requestedAt: now,
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Monday"
  )
  let grant = try state.beginChildSession(
    begin,
    guardianSessionID: guardianSessionID,
    completionCapability: capability,
    now: now
  )
  #expect(state.homeworkMode)
  #expect(state.status.activeChildSession == grant.session)
  #expect(state.auditLog.last?.operation == .beginChildSession)

  let retry = GuardianBeginChildSessionRequest(
    requestedAt: now,
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Monday"
  )
  #expect(try state.beginChildSession(
    retry,
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "Z", count: 43),
    now: now
  ) == grant)

  let proof = GuardianServiceCompletionProof(
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Monday",
    eligibleAt: now.addingTimeInterval(-60),
    requiredCompleted: 5,
    requiredTarget: 5,
    optionalCompleted: 3,
    optionalTarget: 3
  )
  let denied = GuardianCompleteChildSessionRequest(
    requestedAt: now,
    guardianSessionID: guardianSessionID,
    completionCapability: String(repeating: "B", count: 43),
    proof: proof
  )
  #expect(throws: GuardianChildSessionError.completionCapabilityDenied) {
    try state.completeChildSession(denied, now: now)
  }
  #expect(state.homeworkMode)

  let completion = GuardianCompleteChildSessionRequest(
    requestedAt: now,
    guardianSessionID: guardianSessionID,
    completionCapability: capability,
    proof: proof
  )
  let completed = try state.completeChildSession(completion, now: now)
  #expect(!completed.homeworkMode)
  #expect(completed.activeChildSession == nil)
  #expect(completed.lastClosedChildSession?.outcome == .completed)
  #expect(state.auditLog.last?.operation == .completeChildSession)

  let replay = GuardianBeginChildSessionRequest(
    requestedAt: now,
    serviceSessionID: serviceSessionID,
    weekID: "2027-01-11",
    day: "Monday"
  )
  #expect(throws: GuardianChildSessionError.sessionAlreadyClosed) {
    try state.beginChildSession(
      replay,
      guardianSessionID: UUID(),
      completionCapability: capability,
      now: now
    )
  }
}

@Test func parentOverrideClosesAChildSessionAndPreventsRestart() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let serviceSessionID = UUID(uuidString: "22222222-3333-4444-8555-666666666666")!
  var state = GuardianDaemonState()
  try state.beginChildSession(
    GuardianBeginChildSessionRequest(
      requestedAt: now,
      serviceSessionID: serviceSessionID,
      weekID: "2027-01-11",
      day: "Tuesday"
    ),
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "C", count: 43),
    now: now
  )
  let status = try state.apply(GuardianSetHomeworkModeRequest(
    requestedAt: now,
    enabled: false,
    auditReason: "Parent approved an early release"
  ), now: now)
  #expect(!status.homeworkMode)
  #expect(status.lastClosedChildSession?.outcome == .parentOverride)

  #expect(throws: GuardianChildSessionError.sessionAlreadyClosed) {
    try state.beginChildSession(
      GuardianBeginChildSessionRequest(
        requestedAt: now,
        serviceSessionID: serviceSessionID,
        weekID: "2027-01-11",
        day: "Tuesday"
      ),
      guardianSessionID: UUID(),
      completionCapability: String(repeating: "D", count: 43),
      now: now
    )
  }
}

@Test func aNewServiceLifecycleSupersedesThePriorActiveSession() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let firstID = UUID(uuidString: "33333333-4444-4555-8666-777777777777")!
  let secondID = UUID(uuidString: "44444444-5555-4666-8777-888888888888")!
  var state = GuardianDaemonState()
  try state.beginChildSession(
    GuardianBeginChildSessionRequest(
      requestedAt: now,
      serviceSessionID: firstID,
      weekID: "2027-01-11",
      day: "Wednesday"
    ),
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "E", count: 43),
    now: now
  )
  let second = try state.beginChildSession(
    GuardianBeginChildSessionRequest(
      requestedAt: now,
      serviceSessionID: secondID,
      weekID: "2027-01-11",
      day: "Wednesday"
    ),
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "F", count: 43),
    now: now
  )
  #expect(state.homeworkMode)
  #expect(second.session.serviceSessionID == secondID)
  #expect(state.lastClosedChildSession?.serviceSessionID == firstID)
  #expect(state.lastClosedChildSession?.outcome == .superseded)
}

@Test func completionProofRequiresTheExactDailyTargets() throws {
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let serviceSessionID = UUID(uuidString: "55555555-6666-4777-8888-999999999999")!
  let valid = GuardianCompleteChildSessionRequest(
    requestedAt: now,
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "H", count: 43),
    proof: GuardianServiceCompletionProof(
      serviceSessionID: serviceSessionID,
      weekID: "2027-01-11",
      day: "Tuesday",
      eligibleAt: now,
      requiredCompleted: 5,
      requiredTarget: 5,
      optionalCompleted: 6,
      optionalTarget: 6
    )
  )
  try GuardianRequestValidator.validate(valid, now: now)

  let reducedTarget = GuardianCompleteChildSessionRequest(
    requestedAt: now,
    guardianSessionID: UUID(),
    completionCapability: String(repeating: "H", count: 43),
    proof: GuardianServiceCompletionProof(
      serviceSessionID: serviceSessionID,
      weekID: "2027-01-11",
      day: "Tuesday",
      eligibleAt: now,
      requiredCompleted: 4,
      requiredTarget: 4,
      optionalCompleted: 5,
      optionalTarget: 5
    )
  )
  #expect(throws: GuardianRequestValidationError.invalidCompletionProof) {
    try GuardianRequestValidator.validate(reducedTarget, now: now)
  }
}
