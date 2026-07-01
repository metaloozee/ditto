FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3

COPY sandbox/pi/ /opt/ditto/pi/
