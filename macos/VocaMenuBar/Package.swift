// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "VocaMenuBar",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "VocaMenuBar", targets: ["VocaMenuBar"])
  ],
  targets: [
    .executableTarget(name: "VocaMenuBar")
  ]
)
