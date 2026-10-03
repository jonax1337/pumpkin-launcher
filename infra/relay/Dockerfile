# iroh-relay publishes no image whose origin we could verify here, so we build exactly the
# crate version the launcher uses as iroh (src-tauri/Cargo.lock). Lockstep updates: bump the arg.
ARG RUST_VERSION=1.91
ARG IROH_RELAY_VERSION=1.3.0

FROM rust:${RUST_VERSION}-bookworm AS build
ARG IROH_RELAY_VERSION
RUN cargo install iroh-relay --version "=${IROH_RELAY_VERSION}" --locked --features server --root /out

FROM debian:bookworm-slim
# ca-certificates: ACME client. curl: healthcheck against the local metrics port.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home relay \
 && mkdir /data \
 && chown relay:relay /data
COPY --from=build /out/bin/iroh-relay /usr/local/bin/iroh-relay
USER relay
VOLUME /data
ENTRYPOINT ["iroh-relay"]
CMD ["--config-path", "/etc/iroh-relay/relay.toml"]
