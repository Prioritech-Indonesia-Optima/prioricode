import type { Scenario } from "../runner"
import { scenarios as loopGuard } from "./loop-guard"
import { scenarios as providerRetry } from "./provider-retry"
import { scenarios as verifyPass } from "./verify-pass"

export const scenarios: Scenario[] = [...loopGuard, ...providerRetry, ...verifyPass]
