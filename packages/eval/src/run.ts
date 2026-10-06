process.env.PRIORICODE_DB = process.env.PRIORICODE_DB ?? ":memory:"
process.env.PRIORICODE_DISABLE_MODELS_FETCH = "true"

import fs from "fs/promises"
import os from "os"
import path from "path"
import { evaluate } from "./runner"
import { scenarios } from "./scenarios"

async function main() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-eval-")))
  const results = []
  for (const scenario of scenarios) results.push(await evaluate(scenario, directory))
  await fs.rm(directory, { recursive: true, force: true })
  for (const result of results)
    console.log(
      `${result.passed ? "PASS" : "FAIL"}  ${result.name}${result.error === undefined ? "" : `\n${result.error}`}`,
    )
  const failed = results.filter((result) => !result.passed).length
  console.log(`\n${results.length - failed}/${results.length} scenarios passed`)
  if (failed > 0) process.exitCode = 1
}

if (import.meta.main) await main()
