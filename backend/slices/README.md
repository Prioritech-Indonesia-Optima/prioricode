# Vertical slices

The five layer packages form a **horizontal spine** — a fixed dependency direction that
must not be re-nested, because re-nesting would break the `protocol → client` codegen
pipeline and the shared Effect service graph:

```
schema  ←  protocol  ←  server
   ↑           ↑           ↑
   └────────── core ───────┘
                 ↑
               client  (generated from protocol)
```

- **`schema`** — browser-safe wire/storage contracts (no runtime behavior).
- **`protocol`** — the `/api/...` HttpApi surface (groups + endpoints + OpenAPI).
- **`core`** — the Effect service graph that implements the domain.
- **`server`** — HttpApi handlers that bind the protocol to core services.
- **`client`** — generated from `protocol` (do not edit `src/generated/*`).

## Slice vs floor

- **Slice** — one feature's code, traced _vertically_ through the packages above. A slice
  is the unit of understanding and of incremental migration. Each slice has a manifest in
  this directory (`<name>.md`) listing its files in each package, its floor dependencies,
  and its cross-slice consumers.
- **Floor** — cross-cutting infrastructure that slices depend on but do not own: `effect`
  (app-node/layer-node), `database`, `util`, `id`, `config`, `observability`, `flag`,
  `global`, `state`. Floors live mostly in `core` and are carved out incrementally as
  slices are migrated. A floor dependency is _expected_; a slice-to-slice dependency is
  the thing to watch.

## The 5-package span

Every slice is traceable by hand across exactly these locations:

| Package    | Location of a slice `X`                                             |
| ---------- | ------------------------------------------------------------------- |
| `schema`   | `schema/src/X.ts` (current) + `schema/src/v1/X.ts` (legacy)         |
| `protocol` | `protocol/src/groups/X.ts`                                          |
| `core`     | `core/src/X.ts` (service) + `core/src/tool/X.ts` (if it has a tool) |
| `server`   | `server/src/handlers/X.ts`                                          |
| `client`   | `client/src/generated/{types,client}.ts` (generated from protocol)  |

## Migration rules

1. **Never re-nest the layer packages.** The horizontal spine stays; the vertical dimension
   is expressed by these manifests, not by moving directories.
2. **A slice owns its contract end-to-end.** If you change `schema/src/X.ts`, the blast
   radius is the `X` slice (protocol group → server handler → generated client), not the
   whole package.
3. **Floor deps are fine; slice-to-slice deps are the smell.** When a slice starts importing
   another slice's internals (not its public contract), record it in the manifest's
   _Cross-slice consumers_ and consider whether the shared part belongs in a floor.
4. **V1 coexistence is temporary.** Current contracts are unversioned (`X`); legacy ones are
   `XV1` under `src/v1/`. A manifest lists both when the slice spans the v1/v2 boundary.
5. **Codegen is the gate.** After touching a slice's protocol surface, `cd backend/client &&
bun run check:generated` must pass (regenerate + no diff).

## Slice inventory

Derived from `protocol/src/groups/` and `server/src/handlers/`, which mirror 1:1.
`status`: `migrated` = has an accurate manifest + traced; `pending` = not yet.

| Slice          | status   | notes                                    |
| -------------- | -------- | ---------------------------------------- |
| `question`     | migrated | PoC — see [`question.md`](./question.md) |
| `agent`        | pending  |                                          |
| `command`      | pending  |                                          |
| `credential`   | pending  |                                          |
| `event`        | pending  | floor-ish (cross-cutting event bus)      |
| `fs`           | pending  |                                          |
| `health`       | pending  | floor-ish (infra endpoint)               |
| `integration`  | pending  |                                          |
| `location`     | pending  | floor-ish (placement mechanism)          |
| `message`      | pending  |                                          |
| `model`        | pending  |                                          |
| `permission`   | pending  |                                          |
| `project-copy` | pending  |                                          |
| `provider`     | pending  |                                          |
| `pty`          | pending  |                                          |
| `reference`    | pending  |                                          |
| `session`      | pending  |                                          |
| `skill`        | pending  |                                          |
