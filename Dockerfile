# Release CI should record resolved image digests and scan the final image.
FROM node:24-bookworm-slim AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1.90-bookworm AS api
WORKDIR /src/backend
COPY backend/ ./
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nolya && useradd --uid 10001 --gid nolya --no-create-home nolya \
    && mkdir -p /app/data && chown nolya:nolya /app/data && chmod 700 /app/data
WORKDIR /app
COPY --from=api /src/backend/target/release/nolya-api /usr/local/bin/nolya-api
COPY --from=web /src/frontend/dist /app/static
ENV NOLYA_BIND=0.0.0.0:3000 NOLYA_DB_PATH=/app/data/nolya.sqlite NOLYA_STATIC_DIR=/app/static
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --output /dev/null http://127.0.0.1:3000/api/v1/health/ready || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/nolya-api"]
