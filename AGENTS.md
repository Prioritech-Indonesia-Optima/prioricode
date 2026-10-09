# Repository rules

## Shipping

- All changes ship through `main`. Feature branches land via merge into
  `main` after verification; never publish releases, tags, or packaged
  artifacts straight from a feature branch.
- A branch is merge-ready only when `bun run typecheck`, `bun run lint`,
  and the touched packages' test suites are green.
- Desktop artifacts (AppImage/deb/dmg/nsis) are produced from `main`
  by CI; local packages are for verification only.

## Verification

- Typecheck: `bun run typecheck` (turbo, project references).
- Lint: `bun run lint` (oxlint).
- Tests: run per package (`cd frontend/gui && bun test`, etc.).
  The repo root intentionally blocks `bun test`.
- i18n: frontend work that mods or adds features may need language
  updates too — if (and only if) it introduces or changes user-visible
  copy, add the English keys and run `bun run translate:app -- all` (or
  the affected locales) before merge; `frontend/gui` i18n parity tests
  enforce it.

## Brand assets

- Never hand-edit generated brand files. Update
  `branding/source/2026-lockup.png` and run `bun run script/generate-brand.ts`.
