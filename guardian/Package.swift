// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "FionnbarHomeworkGuardian",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "homework-guardian", targets: ["HomeworkGuardian"]),
    .executable(name: "fionnbar-homework-parent", targets: ["GuardianParent"]),
    .executable(name: "homework-guardian-agent", targets: ["GuardianAgent"]),
    .executable(name: "homework-guardian-daemon", targets: ["GuardianDaemon"]),
    .executable(name: "fionnbar-homework-service", targets: ["HomeworkServiceLauncher"]),
    .library(name: "GuardianXPC", targets: ["GuardianXPC"]),
  ],
  targets: [
    .executableTarget(name: "HomeworkGuardian"),
    .target(name: "GuardianXPC"),
    .executableTarget(name: "GuardianParent", dependencies: ["GuardianXPC"]),
    .executableTarget(name: "GuardianAgent", dependencies: ["GuardianXPC"]),
    .executableTarget(name: "GuardianDaemon", dependencies: ["GuardianXPC"]),
    .executableTarget(name: "HomeworkServiceLauncher", dependencies: ["GuardianXPC"]),
    .testTarget(
      name: "HomeworkGuardianTests",
      dependencies: ["HomeworkGuardian", "GuardianXPC"]
    ),
  ]
)
