# Dedicated private scanner service. Do not deploy using the MEMS application service account.
FROM node:22-bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends clamav clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /scanner
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY scanner/server.ts ./scanner/server.ts
RUN freshclam
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node","--import","tsx","scanner/server.ts"]
