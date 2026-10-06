# prioricode for VS Code

A full coding-agent harness inside your editor — [prioricode](https://prioricode.ai) as a native GUI, not a terminal. Chat with streaming answers, watch and steer tool calls, review diffs, approve permissions, and keep a real terminal at hand, all from the sidebar.

## Prerequisites

This extension talks to a running **prioricode server**. Install the [prioricode CLI](https://prioricode.ai) and either let the extension start the local service automatically (`prioricode service start`, run for you when the workspace is trusted), or point it at any reachable server with `prioricode: Connect to prioricode Server…` / the `prioricode.serverUrl` setting.

## Features

### Chat panel

Open the prioricode icon in the Activity Bar (or `prioricode: Open prioricode Chat`).

- **Streaming transcript** with tool-call cards (running/success/error, expandable input and results), shell output, reasoning summaries, retry notes, and per-turn cost/token stats.
- **Permission review before it lands** — edit/bash permissions show the actual unified diff and let you Allow once, Always allow, or Reject.
- **Structured questions** with option chips, multi-select, and free-text answers.
- **Sessions sidebar** — search, switch, and resume any server session; history restores exactly (durable event replay) and live updates reconnect automatically.
- **Model & agent pickers** per session, powered by your connected providers; connect new providers (API keys or OAuth) without leaving the panel.
- **@-mentions** — type `@` to fuzzy-find workspace files and attach them (`@src/api.ts#L10-20`), with removable context chips; attach the current editor selection with one click.
- **Checkpoint review** — "revert to here" on any message, a staged checkpoint bar listing changed files with diffs, and Keep/Undo actions backed by server snapshots.
- **Embedded terminal** (xterm.js) attached to a server PTY with cursor replay — survives disconnects and keeps scrollback.
- **Images** — Ctrl+V clipboard paste or file attach, delivered as real attachments.
- **Steer or queue** mid-turn delivery, Stop button, RTL-ready layout, editor-theme matching.

### Terminal bridge

- **Quick Launch**: `Cmd+Esc` (Mac) / `Ctrl+Esc` (Windows/Linux) opens prioricode in a split terminal; `Cmd/Ctrl+Shift+Esc` starts a fresh session.
- **File references**: `Cmd+Option+K` (Mac) / `Alt+Ctrl+K` inserts `@File#L37-42` into the terminal prompt; clipboard images paste into the TUI with `Ctrl+V`.

## Security

- The webview never performs network I/O: all requests stream through the extension host, which holds server discovery and credentials. Your server password is stored in VS Code SecretStorage and never reaches the webview process.
- The PTY terminal uses short-lived single-use connect tickets minted by the host; WebSocket traffic carries no credentials.

## Development

1. `code sdks/vscode` — open the extension directory (not the repo root). `bun install` inside `sdks/vscode`.
2. The chat UI lives in `packages/gui` (React + Vite, workspace root). Build it once with `bun run --cwd packages/gui build:webview`, then `bun run --cwd sdks/vscode build:ui` copies assets, or run `bun --watch` builds during development.
3. Press `F5` to launch the Extension Development Host; `Developer: Reload Webview` after UI rebuilds.
4. Tests: `bun run --cwd sdks/vscode test:unit` (host relay, discovery, WS client) and `bun run --cwd packages/gui test` (fold, streams, bridge pair-conformance, UI).

Releases are tagged `vscode-vX.Y.Z` and published by the `publish-vscode` workflow (Marketplace + Open VSX when secrets are configured).

## Support

Early release — file issues at https://github.com/Prioritech-Indonesia-Optima/prioricode/issues.
