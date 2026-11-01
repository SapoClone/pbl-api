# Gateway image: KrakenD CE 2.6.3 + the pbl-error-body http-server plugin.
# Plugins must be built with the builder of the EXACT same KrakenD version
# (same Go toolchain, same libc), so both stages are pinned to 2.6.3.
FROM krakend/builder:2.6.3 AS builder
WORKDIR /src
COPY plugins/error-body/ ./
RUN go test ./... \
 && go build -buildmode=plugin -o /out/pbl-error-body.so .

FROM devopsfaith/krakend:2.6.3
COPY --from=builder /out/pbl-error-body.so /opt/krakend/plugins/pbl-error-body.so

# Production: bake the rendered config in (`node scripts/render-krakend-prod.mjs > krakend/krakend.prod.json`,
# then `--build-arg GATEWAY_CONFIG=krakend.prod.json`). Locally compose mounts krakend.json over this.
ARG GATEWAY_CONFIG=krakend.json
COPY ${GATEWAY_CONFIG} /etc/krakend/krakend.json
CMD ["run", "-c", "/etc/krakend/krakend.json"]
