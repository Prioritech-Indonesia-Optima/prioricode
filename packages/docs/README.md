# PrioriCode Docs

The documentation site for [PrioriCode](https://code.prioritech.co.id), the open source AI coding
agent by Prioritech Indonesia Optima. Built with [Mintlify](https://mintlify.com).

## Structure

- `docs.json` — the whole site map: brand, `banner`, and `navigation.versions` → one entry per minor
  release line (currently `v0.1`, default, tagged "Latest") wrapping three tabs: Documentation, Reference, SDK.
- Getting started: `index.mdx`, `quickstart.mdx`, `getting-started/` (install, providers).
- `using/` — tui, sessions, agents, permissions, context, headless, sharing, coordination.
- `extending/` — skills, commands, mcp, hooks, plugins, custom-tools, formatters, lsp, editors.
- `configure/` — files (config discovery), tui (themes & keybinds).
- `platforms/` — server, desktop, github, enterprise. `support/` — troubleshooting, versions.
- `reference/` — single-source tables: cli, slash-commands, keybinds, config, environment-variables, tools, providers.
- `sdk.mdx` — TypeScript SDK overview (API reference is generated from `openapi.json`).
- `logo/` + `favicon.svg` — Prioritech brand assets (light/dark variants).

Docs are release-blocking: any user-facing change updates these pages **in the same commit** (see root `AGENTS.md`).
Keep numeric defaults and inventories in `reference/` tables only — concept pages explain, tables enumerate.

## Version snapshots

Root content always tracks the latest line. When a new minor/major line ships: copy the tree into a
`<line>/` folder (e.g. `v0.1/`), add a non-default `navigation.versions` entry pointing at those paths,
and make the root the new default line. Snapshots are never edited afterwards.

## Published mirror

This directory is the canonical authoring source. The public site at `https://code.prioritech.co.id/docs/`
is a VitePress mirror in the `prioricode-dist` repo (local clone: `prioricode-dist/` at this repo root),
generated mechanically from these pages:

```bash
cd prioricode-dist/docs-src
bun scripts/sync-from-source.mjs   # converts packages/docs MDX -> VitePress markdown + sidebar/banner
bun run build                      # regenerates ../docs (commit source and output together)
```

Because of the port, pages must stay host-agnostic: no Mintlify-only references ("this tab", the playground
as a UI), no endpoint/feature counts, and links as root-relative `/paths` (the sync script rewrites them;
`/openapi.json` resolves from each site's public/symlinked spec).

## Development

```bash
npm i -g mint
cd packages/docs
mint dev
```

Open `http://localhost:3000`. Preview updates automatically as you edit files.

## Brand

Colors follow the Prioritech palette: amber `#F9B110`, charcoal `#2D2C2C`, cream `#FAF9F6`.
Vector assets live in the repo root at `branding/`.
