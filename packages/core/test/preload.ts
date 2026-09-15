import path from "path"

process.env.PRIORICODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.PRIORICODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.PRIORICODE_DISABLE_MODELS_FETCH = "true"
