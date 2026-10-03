import Testing
@testable import HomeworkGuardian

@Test func inactiveModeNeverBlocks() {
  #expect(decideGuardianAction(
    homeworkMode: false,
    activeBundleId: "com.apple.Terminal",
    blockedBundleIds: ["com.apple.Terminal"]
  ) == .inactive)
}

@Test func blockedApplicationIsDetectedDuringHomework() {
  #expect(decideGuardianAction(
    homeworkMode: true,
    activeBundleId: "com.apple.Terminal",
    blockedBundleIds: ["com.apple.Terminal"]
  ) == .blocked)
}

@Test func approvedApplicationRemainsAllowed() {
  #expect(decideGuardianAction(
    homeworkMode: true,
    activeBundleId: "com.google.Chrome",
    blockedBundleIds: ["com.apple.Terminal"]
  ) == .allowed)
}

@Test func enforcementRequiresTwoExplicitOptIns() throws {
  #expect(try enforcementEnabled(requested: false, configurationAllows: true, simulating: false) == false)
  #expect(try enforcementEnabled(requested: true, configurationAllows: true, simulating: false) == true)
  #expect(throws: GuardianError.enforcementNotAuthorized) {
    try enforcementEnabled(requested: true, configurationAllows: false, simulating: false)
  }
  #expect(throws: GuardianError.invalidArguments("--enforce cannot be combined with --simulate-homework")) {
    try enforcementEnabled(requested: true, configurationAllows: true, simulating: true)
  }
}
