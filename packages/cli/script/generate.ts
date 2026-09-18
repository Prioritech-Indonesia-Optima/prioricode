const modelsUrl = process.env.PRIORICODE_MODELS_URL || "https://models.prioricode.ai"

export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await (async () => {
      try {
        return await fetch(`${modelsUrl}/api.json`).then((response) => response.text())
      } catch {
        console.log(`Failed to fetch ${modelsUrl}/api.json; falling back to https://models.dev/api.json`)
        return await fetch("https://models.dev/api.json").then((response) => response.text())
      }
    })()

console.log("Loaded models.dev snapshot")
