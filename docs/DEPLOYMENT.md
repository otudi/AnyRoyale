# Deployment

AnyRoyale is one Docker web service: the Java server serves the built client, the REST/health
endpoints and the WebSocket game protocol on a single port. No database, no external services.

## Render (recommended)

Nothing has been deployed to Render from this repository yet; the steps below create a **new**
service and do not touch existing ones.

### Option A — Blueprint

1. Render dashboard → **New → Blueprint** → select this repository and branch.
2. Render reads `render.yaml` and proposes one web service `anyroyale` (Docker, `starter` plan,
   Frankfurt, health check `/healthz`, a generated `SESSION_SECRET`). Change plan/region if
   needed, then **Apply**.

### Option B — Manual web service

1. **New → Web Service** → this repository → Runtime **Docker** (Dockerfile at the repo root).
2. Health check path: `/healthz`.
3. Environment variables:

| Variable | Value | Why |
|---|---|---|
| `SESSION_SECRET` | long random string (keep it stable) | signs guest tokens; if it changes, players get new guest ids |
| `RECONNECT_GRACE_SECONDS` | `30` | seat kept after a disconnect |
| `MAX_MATCHES` | `100` on starter | concurrent match cap |
| `TICK_THREADS` | `2` | match tick threads |
| `REPLAY_DIR` | optional, e.g. a mounted disk path | replays are in memory otherwise |

`PORT` is injected by Render; the server binds `0.0.0.0:$PORT`. Do not set `STATIC_DIR` (the
image sets `/app/web`).

### What to expect

- First deploy builds three stages (web client with Node 22, server with Gradle/JDK 21, runtime
  on JRE 21) — several minutes; later builds reuse cached layers.
- On the **free** plan the service sleeps when idle; the first visit then waits for a cold start
  and any running match is lost when it sleeps. Use `starter` or above for online play.
- WebSockets work on Render web services without extra configuration (same origin, `wss://`).
- Deploys send `SIGTERM`: the server tells players in matches that it is restarting, stops ticking
  and closes sockets with code 1012. Matches in progress at that moment end; there is no state
  hand-over between instances.
- Run **one instance**. Matches, queues and rooms live in the process memory; horizontal scaling
  would need sticky routing by match plus a shared queue, which is not implemented.

### Observability

- `GET /healthz` → `{"status":"ok","matches":N,"cards":111}`.
- `GET /api/stats` → uptime, connections, queue/rooms, active/started/finished matches, heap,
  CPU, per-match tick timing.
- Logs (stdout): server start, match start/end with reason, disconnects, rejected actions,
  slow-client drops, shutdown.

## Any Docker host

```bash
docker build -t anyroyale .
docker run -p 8080:8080 -e SESSION_SECRET=$(openssl rand -hex 32) anyroyale
# open http://localhost:8080
```

Put a TLS terminator (Caddy, nginx, a cloud load balancer) in front for HTTPS/WSS; mobile Safari
requires a secure context for some features (e.g. fullscreen/orientation APIs).

## Without Docker (development)

```bash
./gradlew :server:installDist
(cd apps/web && npm ci && npm run build)
STATIC_DIR=apps/web/dist ./server/app/build/install/anyroyale-server/bin/anyroyale-server
# or: cd apps/web && npm run dev   (Vite on :5173 proxies /api, /healthz, /ws to :8080)
```

Requirements: JDK 17+ (built and tested on 21), Node 22.

## Verified locally

The runtime stage of the image (JRE 21, non-root user `anyroyale`, `PORT` respected) was run with
`--memory=512m --cpus=0.5` (Render starter size) and the browser suite was run against it; see
`docs/TEST_REPORT.md`. The full multi-stage build runs in CI (`docker` job in
`.github/workflows/ci.yml`), which also starts the container and checks `/healthz` and `/`.
