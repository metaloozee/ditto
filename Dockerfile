FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3 tsx

COPY sandbox/pi/ /opt/ditto/pi/
COPY sandbox/runner/ /opt/ditto/sandbox/runner/
COPY src/lib/runner-protocol.ts /opt/ditto/src/lib/runner-protocol.ts
