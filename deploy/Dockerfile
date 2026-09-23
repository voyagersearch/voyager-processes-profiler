# Multi-stage build mirroring voyager-mastra-full-rag's pattern.
# The file:-linked sibling voyager-prov-ts is passed in as an additional
# build context (name: prov) so we can package it into the runtime image
# and the symlinked node_modules entry resolves at run time.

# ── Stage 1 — build voyager-prov-ts from the sibling context ──────────────
FROM node:20-alpine AS prov-build
WORKDIR /prov
COPY --from=prov . .
RUN npm install --no-audit --no-fund \
  && (npm run build --if-present || true)

# ── Stage 2 — build the D120 app ──────────────────────────────────────────
FROM node:20-alpine AS app-build
WORKDIR /app
# voyager-prov-ts must live at the file:-dep target BEFORE npm install so the
# symlink resolves. package.json expects it at ../voyager-prov-ts relative to
# the repo, which inside the container maps to /voyager-prov-ts.
COPY --from=prov-build /prov /voyager-prov-ts
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ── Stage 3 — slim runtime ────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
# Runtime needs the built voyager-prov-ts at the same relative path the
# node_modules symlink points to.
COPY --from=app-build /voyager-prov-ts /voyager-prov-ts
COPY --from=app-build /app/node_modules ./node_modules
COPY --from=app-build /app/dist ./dist
COPY --from=app-build /app/package.json ./package.json
# OpenAPI spec is read at request time by src/routes/openapi.ts — include it.
COPY openapi ./openapi

EXPOSE 4601
CMD ["node", "dist/index.js"]
