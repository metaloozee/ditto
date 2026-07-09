FROM docker.io/cloudflare/sandbox:0.12.1

COPY sandbox/runner /opt/ditto-runner
WORKDIR /opt/ditto-runner

RUN npm ci \
  && npm run build \
  && npm prune --omit=dev \
  && chmod +x dist/cli.js \
  && ln -sf /opt/ditto-runner/dist/cli.js /usr/local/bin/ditto-runner

WORKDIR /workspace