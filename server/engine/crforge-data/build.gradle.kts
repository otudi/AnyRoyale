plugins {
    `java-library`
}

dependencies {
    api(project(":crforge-core"))
    api(libs.jackson.databind)
    api(libs.slf4j.api)
    testImplementation(libs.slf4j.simple)

    compileOnly(libs.lombok)
    annotationProcessor(libs.lombok)
    testCompileOnly(libs.lombok)
    testAnnotationProcessor(libs.lombok)
}
