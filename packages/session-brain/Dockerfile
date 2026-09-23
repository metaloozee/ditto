FROM node:22-bookworm-slim
WORKDIR /opt/ditto-session-brain
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev
CMD ["node", "-e", "import('./dist/main.js').then(() => { console.log('brain-process-started'); console.log('barrier-enforcers object'); })"]
