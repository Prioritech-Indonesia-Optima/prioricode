FROM oven/bun:1.3.14-alpine AS base

WORKDIR /app

ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

FROM base AS pruner

COPY . .

RUN bunx turbo@2.8.13 prune @prioricode/stats-server --docker --no-update-notifier --no-color

FROM base AS installer

COPY --from=pruner /app/out/json/ ./

# Bun 1.3.x needs the pruned workspace globs and lockfile metadata refreshed before the frozen production install.
# Derive the member list from the workspaces globs themselves so this stays correct regardless of the on-disk layout.
RUN bun -e 'const packageJson = await Bun.file("package.json").json(); const globs = packageJson.workspaces.packages; const files = globs.flatMap((g) => Array.from(new Bun.Glob(g + "/package.json").scanSync("."))); packageJson.workspaces.packages = files.map((file) => file.slice(0, -"/package.json".length)).sort(); await Bun.write("package.json", JSON.stringify(packageJson, null, 2) + "\n")'
RUN rm -f bun.lock && bun install --filter @prioricode/stats-server --lockfile-only --ignore-scripts
RUN bun install --filter @prioricode/stats-server --frozen-lockfile --production --ignore-scripts

FROM base AS runner

COPY --from=installer /app ./
COPY --from=pruner /app/out/full/ ./

WORKDIR /app/cloud/stats/server

EXPOSE 3000

CMD ["bun", "src/server.ts"]
