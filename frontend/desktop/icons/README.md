# Desktop icons

All channel icon sets are generated — do not edit them by hand.

```
bun run script/generate-brand.ts
```

The script derives every raster from `branding/source/2026-lockup.png`:

- mark-only crop composited on a rounded black tile (app icons, favicons)
- transparent lockup/wordmark/mark in white and ink variants (UI, docs, OG images)
- `icon.ico` / `icon.icns` via `png2icons`, UWP squares, dock and NxN pngs

All three channels (`dev`, `beta`, `prod`) intentionally share the same tile;
channels still differ by app id and product name in `electron-builder.config.ts`.

`resources/icons` is regenerated from `icons/<channel>` by `scripts/copy-icons.ts`
during `predev`/`prebuild` and stays gitignored.
