# Small VM: a headless Linux "remote host" for diagnosing Windows→Linux Ctrl+V.
#
# It runs the REAL PrioriCode paste modules (copied in, relative layout
# preserved so `../../frontend/tui/src/*` imports in tooling/vm/diagnose.ts
# resolve) under bun, with no display server and no xclip/wl-paste/xsel —
# exactly like a bare SSH host. The "Windows terminal" side is simulated
# in-process by diagnose.ts.
#
# No node_modules are copied: the core path uses an injected ClipboardEnvironment
# and only bun/node builtins plus the local source files.
FROM oven/bun:1

WORKDIR /app

COPY frontend/tui/src/clipboard-terminal.ts /app/frontend/tui/src/
COPY frontend/tui/src/clipboard.ts          /app/frontend/tui/src/
COPY frontend/tui/src/clipboard-scenario.ts /app/frontend/tui/src/
COPY frontend/tui/src/clipboard-win32.ts    /app/frontend/tui/src/
COPY frontend/tui/src/component/prompt/paste-store.ts /app/frontend/tui/src/component/prompt/
COPY tooling/vm/diagnose.ts                 /app/tooling/vm/

# Model a remote SSH session on a headless host (diagnose.ts also sets these,
# but declaring them makes the VM's environment explicit and inspectable).
ENV SSH_CONNECTION="203.0.113.10 22 198.51.100.23 51234" \
    SSH_TTY="/dev/pts/0"

CMD ["bun", "/app/tooling/vm/diagnose.ts"]
