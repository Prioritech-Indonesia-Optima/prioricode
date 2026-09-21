# PrioriCode Docs

The documentation site for [PrioriCode](https://code.prioritech.co.id), the open source AI coding
agent by Prioritech Indonesia Optima. Built with [Mintlify](https://mintlify.com).

## Structure

- `docs.json` — site config: brand colors, logos, navigation, navbar/footer links.
- `index.mdx` — landing page for the docs.
- `quickstart.mdx` — install → connect a provider → run.
- `sdk.mdx` — TypeScript SDK overview (API reference is generated from `openapi.json`).
- `logo/` + `favicon.svg` — Prioritech brand assets (light/dark variants).

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
