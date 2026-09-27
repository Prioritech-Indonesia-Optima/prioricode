# PrioriCode Eval

Offline, deterministic evaluation harness for the V2 coding-agent loop. Every
scenario drives the **real** durable runner — event log, projector, input
admission, tool registry, loop guards, and the automatic verification pass —
against scripted provider turns. No network, no API keys.

## Run

```sh
bun run --cwd packages/eval eval
```

Exits non-zero when any scenario regresses, so it can gate prompt, tool, and
loop changes in CI.

## Add a scenario

Drop a file in `src/scenarios/` exporting `Scenario` (see `loop-guard.ts`):

- `config` wires `ConfigLoop` / `ConfigVerify` exactly like `prioricode.json`.
- `main` receives a `Harness` (`turns` scripts provider responses, `failNext`
  injects a retryable provider error, `requests`/`writes` observe activity), the
  real `SessionV2` facade, and a fresh `sessionID`.
- Fail with `Effect.fail(new Error(...))` to mark the scenario red.
