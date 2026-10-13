plugins {
    application
}

dependencies {
    implementation(project(":crforge-data"))
    implementation(libs.javalin)
    implementation(libs.jackson.databind)
    implementation(libs.slf4j.simple)
}

application {
    mainClass.set("com.anyroyale.server.AnyRoyaleServer")
    applicationName = "anyroyale-server"
}

tasks.withType<Test> {
    // Integration tests start real servers on ephemeral ports.
    systemProperty("anyroyale.test", "true")
}
