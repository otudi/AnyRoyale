plugins {
    `java-library`
}

dependencies {
    // Upstream tests need CardRegistry to build decks
    testImplementation(project(":crforge-data"))

    compileOnly(libs.lombok)
    annotationProcessor(libs.lombok)
    testCompileOnly(libs.lombok)
    testAnnotationProcessor(libs.lombok)
}
