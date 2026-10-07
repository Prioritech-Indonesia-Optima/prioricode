# Slice: `question`

`status: migrated` (PoC)

Asks the user structured questions during a run and settles the answer (or a rejection)
back into the awaiting tool call. Location-owned: one pending-request map per embedded
Location, so a reply can never settle another Location's deferred request.

## Files by package

### `schema`

- `schema/src/question.ts` — current contract: `ID`, `Option`, `Info`, `Prompt`, `Tool`,
  `Request`, `Answer`, `Reply`, and `Event` (`Asked` / `Replied` / `Rejected`).
- `schema/src/question-v1.ts` — bridge (`export * from "./v1/question"`).
- `schema/src/v1/question.ts` — legacy `QuestionV1` contract (retained for migration).

### `protocol`

- `protocol/src/groups/question.ts` — `makeQuestionGroup`, 4 endpoints:
  - `question.request.list` → `GET /api/question/request`
  - `session.question.list` → `GET /api/session/:sessionID/question`
  - `session.question.reply` → `POST /api/session/:sessionID/question/:requestID/reply`
  - `session.question.reject` → `POST /api/session/:sessionID/question/:requestID/reject`

### `core`

- `core/src/question.ts` — `QuestionV2` Effect service (`ask` / `reply` / `reject` /
  `list`), a Location-owned layer exposed as `node` via `makeLocationNode`.
- `core/src/tool/question.ts` — `QuestionTool`: the **tool slice's** consumer of this
  slice (the `question` tool the model calls). Listed here because it is the slice's
  primary in-package consumer; it lives in the tool slice's territory.

### `server`

- `server/src/handlers/question.ts` — `QuestionHandler`, binds the 4 protocol endpoints to
  the `QuestionV2` service, with an ownership guard (`withOwnedQuestion`) so a session can
  only reply to / reject its own requests.

### `client` (generated)

- `client/src/generated/types.ts` — `QuestionNotFoundError`, `QuestionsListRequests*`,
  `QuestionsList*`, `QuestionsReply*`, `QuestionsReject*`.
- `client/src/generated/client.ts` — the 4 client methods.
- Regenerate with `cd backend/client && bun run check:generated` (must be a no-op diff).

## Floor dependencies

- `core/src/event` — `EventV2.Service` (publishes `Asked` / `Replied` / `Rejected`).
- `core/src/effect/app-node` — `makeLocationNode` (Location-owned layer plumbing).
- `protocol/src/errors` — `QuestionNotFoundError` (shared error contract).
- `server/src/api` + `server/src/location` — `Api` builder and `response` helper.

## Cross-slice consumers / dependencies

- **Consumed by:** `tool` slice — `core/src/tool/question.ts` (`QuestionTool`) calls
  `QuestionV2.Service.ask`. This is the slice's one deliberate cross-slice edge.
- **Depends on (contract only):** `location` (protocol `LocationQuery` for the
  location-scoped list endpoint) and `session` (`Session.ID` in endpoint params, and a
  type-only `SessionSchema.ID` in core's `AskInput`).

## v1/v2 split

Current contract is unversioned (`Question` in `schema/src/question.ts`); the legacy
`QuestionV1` lives under `schema/src/v1/` and is bridged by `schema/src/question-v1.ts`.
The protocol surface is v2-only (`v2.question.*` / `v2.session.question.*` identifiers).

## Trace (by hand)

1. Model calls the `question` tool → `core/src/tool/question.ts` → `QuestionV2.Service.ask`.
2. `ask` stores a pending `Request` + `Deferred`, publishes `Event.Asked`, awaits the
   deferred.
3. Client lists pending requests via `GET /api/question/request`
   (`server/src/handlers/question.ts` → `QuestionV2.Service.list`).
4. User replies → `POST .../reply` → `QuestionV2.Service.reply` → publishes
   `Event.Replied`, resolves the deferred with the answers.
5. The tool call in step 1 returns the answers; a rejection resolves with `RejectedError`.
