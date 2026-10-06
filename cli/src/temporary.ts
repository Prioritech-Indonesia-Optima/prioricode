import yargs from "yargs"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { ProductVersion } from "@prioricode/core/installation/version"
import { hideBin } from "yargs/helpers"
const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("prioricode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", ProductVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware((opts) => {
    if (opts.printLogs) process.env.PRIORICODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.PRIORICODE_LOG_LEVEL = opts.logLevel
  })
  .command(TuiThreadCommand)
  .parse()
