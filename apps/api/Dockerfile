# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# The API is an npm workspace, so the root lockfile is the only reproducible
# dependency source. Both workspace manifests must be present for `npm ci` to
# resolve the apps/* glob.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/rebuild-docs/package.json apps/rebuild-docs/
RUN npm ci

COPY apps/api apps/api
RUN npx turbo run build --filter=@mangolabs/pos-api

# ---- runtime --------------------------------------------------------------
# Scoped to the API workspace: the docs app keeps React and Docusaurus in
# "dependencies", so a root-wide prod install would drag ~300MB of a site the
# API never loads.
FROM node:24-alpine AS runtime
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/rebuild-docs/package.json apps/rebuild-docs/
RUN npm ci --omit=dev --workspace=@mangolabs/pos-api \
 && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["node", "dist/main.js"]
