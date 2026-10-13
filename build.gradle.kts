plugins {
    java
}

allprojects {
    group = "com.anyroyale"
    version = "1.0.0"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")

    // Bytecode targets Java 17 (the engine's baseline); any JDK >= 17 can build it.
    tasks.withType<JavaCompile> {
        options.release.set(17)
        options.encoding = "UTF-8"
    }

    tasks.withType<Test> {
        useJUnitPlatform()
        maxHeapSize = "1g"
        testLogging {
            events("failed")
            exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        }
    }

    val libs = rootProject.extensions.getByType<VersionCatalogsExtension>().named("libs")

    dependencies {
        testImplementation(libs.findLibrary("junit-jupiter").get())
        testImplementation(libs.findLibrary("assertj-core").get())
        testImplementation(libs.findLibrary("mockito-core").get())
        testRuntimeOnly(libs.findLibrary("junit-platform-launcher").get())
    }
}
