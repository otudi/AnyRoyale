rootProject.name = "anyroyale"

// Vendored crforge battle engine (Apache-2.0). See server/engine/VENDOR.md.
include("crforge-core")
project(":crforge-core").projectDir = file("server/engine/crforge-core")
include("crforge-data")
project(":crforge-data").projectDir = file("server/engine/crforge-data")

// AnyRoyale authoritative game server.
include("server")
project(":server").projectDir = file("server/app")
