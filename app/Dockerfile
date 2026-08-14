# syntax=docker/dockerfile:1

# ---- Builder ----
FROM node:20-slim AS builder
WORKDIR /app

# better-sqlite3 normally installs a prebuilt binary, but keep a toolchain
# available so it can compile from source if a prebuild is missing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Match the npm that generated package-lock.json (v3). The npm bundled with
# node:20-slim (10.x) reads an npm-11 lockfile's optional deps as out-of-sync
# and fails `npm ci`.
RUN npm install -g npm@11

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so the
# owner list must be present here — setting it only at runtime has no effect on
# the browser UI. Passed from fly.toml [build.args].
ARG NEXT_PUBLIC_ACCOUNT_OWNERS=""
ENV NEXT_PUBLIC_ACCOUNT_OWNERS=$NEXT_PUBLIC_ACCOUNT_OWNERS
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Runtime needs: the build output, node_modules (better-sqlite3's native addon +
# tsx for the startup migration), the migration sources, and the checked-in
# taxonomy.json. The SQLite DB itself lives on the mounted volume at /data.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/data/taxonomy.json ./data/taxonomy.json

EXPOSE 3000

# Apply migrations against the mounted volume, then start the server.
# Migrations run here (not as a Fly release_command) because release VMs do not
# mount the volume, so the DB must be created/updated in the running machine.
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && exec node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
