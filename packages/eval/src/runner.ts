import { Effect } from "effect"
import type { LLMEvent } from "@prioricode/llm"
import type { LLMError } from "@prioricode/llm"
import type { ConfigLoop } from "@prioricode/core/config/loop"
import type { ConfigVerify } from "@prioricode/core/config/verify"
import type { SessionSchema } from "@prioricode/core/session/schema"
import type { SessionV2 } from "@prioricode/core/session"
import { provideHarness, type Harness } from "./harness"

export type ScenarioContext = {
  readonly harness: Harness
  readonly sessions: SessionV2.Interface
  readonly sessionID: SessionSchema.ID
}

export type Scenario = {
  readonly name: string
  readonly config?: { readonly loop?: ConfigLoop.Info; readonly verify?: ConfigVerify.Info }
  readonly main: (ctx: ScenarioContext) => Effect.Effect<void, unknown>
}

export type Result = { readonly name: string; readonly passed: boolean; readonly error?: string }

export const evaluate = (scenario: Scenario, directory: string) =>
  provideHarness({ directory, ...scenario.config }, (harness, sessions, sessionID) =>
    scenario.main({ harness, sessions, sessionID }),
  )
    .pipe(Effect.timeoutOption("30 seconds"), Effect.as(true), Effect.runPromise)
    .then(
      (passed) => ({ name: scenario.name, passed: passed === true }),
      (error) => ({
        name: scenario.name,
        passed: false,
        error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
      }),
    ) as Promise<Result>

export type { LLMEvent, LLMError }
