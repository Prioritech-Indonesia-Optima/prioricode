# prioricode for VS Code

A VS Code extension that brings [prioricode](https://prioricode.ai) terminals into your editor: quick-launch a session in a split terminal, drop file references into the prompt, and paste clipboard images into the TUI.

> The chat panel is being rebuilt from scratch and will be re-added in a future release. This extension currently ships the terminal integration only.

## Prerequisites

This extension drives the **prioricode CLI** in a terminal. Install the [prioricode CLI](https://prioricode.ai) and make sure `prioricode` is on your `PATH`.

## Features

### Terminal bridge

- **Quick Launch**: `Cmd+Esc` (Mac) / `Ctrl+Esc` (Windows/Linux) opens prioricode in a split terminal; `Cmd/Ctrl+Shift+Esc` starts a fresh session.
- **File references**: `Cmd+Option+K` (Mac) / `Alt+Ctrl+K` inserts `@File#L37-42` into the terminal prompt; clipboard images paste into the TUI with `Ctrl+V`.

## Development

1. `code sdks/vscode` — open the extension directory (not the repo root). `bun install` inside `sdks/vscode`.
2. Press `F5` to launch the Extension Development Host.
3. Tests: `bun run --cwd sdks/vscode test`.

Releases are tagged `vscode-vX.Y.Z` and published by the `publish-vscode` workflow (Marketplace + Open VSX when secrets are configured).

## Support

Early release — file issues at https://github.com/Prioritech-Indonesia-Optima/prioricode/issues.
