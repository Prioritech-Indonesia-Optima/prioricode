#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./backend/sdk/script/build.ts`

await $`bun dev generate > ../backend/sdk/openapi.json`.cwd("cli")

await $`./script/format.ts`
