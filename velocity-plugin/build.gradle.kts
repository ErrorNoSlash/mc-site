plugins {
    java
}

group = "be.errornoslash"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // Velocity 4 (built for Java 25); the annotation processor writes velocity-plugin.json
    compileOnly("com.velocitypowered:velocity-api:4.3.2-SNAPSHOT")
    annotationProcessor("com.velocitypowered:velocity-api:4.3.2-SNAPSHOT")
}

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 25
    options.encoding = "UTF-8"
}

tasks.jar {
    archiveFileName = "ds-whitelist-${project.version}.jar"
}
