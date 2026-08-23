FROM docker.io/cloudflare/sandbox:0.12.3

COPY --chown=0:0 packages/sandbox-runner /opt/ditto-runner
WORKDIR /opt/ditto-runner

RUN npm install --global corepack@0.35.0 \
  && corepack enable \
  && corepack install --global pnpm@10.34.5 yarn@1.22.22

RUN npm ci \
  && npm run build \
  && npm prune --omit=dev \
  && test -s package.json \
  && test -s dist/cli.js \
  && test -s dist/git-metadata-cli.js \
  && test -s dist/archive-cli.js \
  && test -s dist/ditto-extension.js \
  && node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))' \
  && chmod +x dist/cli.js dist/archive-cli.js \
  && ln -sf /opt/ditto-runner/dist/cli.js /usr/local/bin/ditto-runner \
  && ln -sf /opt/ditto-runner/dist/archive-cli.js /usr/local/bin/ditto-archive

WORKDIR /workspace

# Fixed workspace-session preview port
EXPOSE 10000
