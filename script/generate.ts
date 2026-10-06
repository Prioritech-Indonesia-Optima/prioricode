#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./backend/sdk/script/build.ts`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/prioricode")

await $`./script/format.ts`
