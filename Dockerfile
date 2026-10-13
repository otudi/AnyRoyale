# syntax=docker/dockerfile:1
# AnyRoyale: one container serving the web client, REST/health endpoints, WebSocket game
# protocol and the authoritative crforge battle engine.

# ---- 1. Web client (Vite + TypeScript + three.js) ---------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
RUN npm run build

# ---- 2. Java server (Gradle; bytecode targets Java 17) -----------------------------------------
FROM eclipse-temurin:21-jdk AS server
WORKDIR /src
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle/ gradle/
RUN chmod +x gradlew && ./gradlew --no-daemon --version
COPY server/ server/
RUN ./gradlew --no-daemon :server:installDist -x test

# ---- 3. Runtime ----------------------------------------------------------------------------------
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 --home /app anyroyale
WORKDIR /app
COPY --from=server /src/server/app/build/install/anyroyale-server/ /app/server/
COPY --from=web /src/apps/web/dist/ /app/web/
ENV PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/web \
    JAVA_OPTS="-XX:MaxRAMPercentage=70 -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError -Xss512k"
USER anyroyale
EXPOSE 8080
CMD ["/app/server/bin/anyroyale-server"]
