// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "FionnbarHomeworkGuardian",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "homework-guardian", targets: ["HomeworkGuardian"]),
  ],
  targets: [
    .executableTarget(name: "HomeworkGuardian"),
    .testTarget(name: "HomeworkGuardianTests", dependencies: ["HomeworkGuardian"]),
  ]
)
