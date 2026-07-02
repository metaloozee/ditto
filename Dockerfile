FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts tsx

WORKDIR /opt/ditto/sandbox/runner
COPY sandbox/runner/package.json ./
RUN npm install --omit=dev --ignore-scripts --package-lock=false

COPY sandbox/runner/ ./
COPY src/lib/runner-protocol.ts /opt/ditto/src/lib/runner-protocol.ts

WORKDIR /workspace
