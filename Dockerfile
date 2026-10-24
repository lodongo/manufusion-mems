FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Public Firebase web settings; set at container build time per environment.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG GCP_DEV_PROJECT_ID
ARG GCP_PROD_PROJECT_ID
RUN if [ -n "$GCP_PROD_PROJECT_ID" ]; then \
      test "$GCP_PROD_PROJECT_ID" = "$VITE_FIREBASE_PROJECT_ID" && \
      test -z "$GCP_DEV_PROJECT_ID" && \
      test -n "$VITE_FIREBASE_API_KEY" && \
      test -n "$VITE_FIREBASE_APP_ID"; \
    else node scripts/dev-preflight.mjs build; fi
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
# Server-side HR eligibility imports the shared leave schema at runtime.
# The independent web build alone does not bundle files imported by backend/tsx.
COPY --from=build /app/src/shared ./src/shared
EXPOSE 8080
USER node
CMD ["node", "--import", "tsx", "backend/platform/server.ts"]
