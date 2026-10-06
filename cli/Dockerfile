FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
# GitHub artifact downloads strip the executable bit; set it at COPY time so the
# build never depends on a host-side chmod (e.g. when the npm-publish branch is
# skipped for lack of a token).
COPY --chmod=0755 dist/prioricode-linux-x64-baseline-musl/bin/prioricode /usr/local/bin/prioricode

FROM base AS build-arm64
COPY --chmod=0755 dist/prioricode-linux-arm64-musl/bin/prioricode /usr/local/bin/prioricode

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN prioricode --version
ENTRYPOINT ["prioricode"]
