FROM docker.io/cloudflare/sandbox:0.12.1

COPY --chown=0:0 packages/sandbox-runner /opt/ditto-runner
WORKDIR /opt/ditto-runner

RUN npm ci \
  && npm run build \
  && npm prune --omit=dev \
  && test -s package.json \
  && test -s dist/cli.js \
  && node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))' \
  && chmod +x dist/cli.js \
  && ln -sf /opt/ditto-runner/dist/cli.js /usr/local/bin/ditto-runner

WORKDIR /workspace
