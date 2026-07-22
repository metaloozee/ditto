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
  && test -s dist/provider-auth-cli.js \
  && test -s dist/provider-auth-control-cli.js \
  && test -s dist/provider-catalog-cli.js \
  && test -s dist/git-metadata-cli.js \
  && node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))' \
  && chmod +x dist/cli.js \
    dist/provider-auth-cli.js \
    dist/provider-auth-control-cli.js \
    dist/provider-catalog-cli.js \
  && ln -sf /opt/ditto-runner/dist/cli.js /usr/local/bin/ditto-runner \
  && ln -sf /opt/ditto-runner/dist/provider-auth-cli.js /usr/local/bin/ditto-provider-auth \
  && ln -sf /opt/ditto-runner/dist/provider-auth-control-cli.js /usr/local/bin/ditto-provider-auth-control \
  && ln -sf /opt/ditto-runner/dist/provider-catalog-cli.js /usr/local/bin/ditto-provider-catalog

WORKDIR /workspace

# Session preview port pool (local exposePort)
EXPOSE 10000 10001 10002 10003 10004 10005 10006 10007 10008 10009 10010 10011 10012 10013 10014 10015 10016 10017 10018 10019 10020 10021 10022 10023 10024 10025 10026 10027 10028 10029 10030 10031
