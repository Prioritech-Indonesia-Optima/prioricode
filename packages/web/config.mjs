const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://prioricode.ai" : `https://${stage}.prioricode.ai`,
  console: stage === "production" ? "https://prioricode.ai/auth" : `https://${stage}.prioricode.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/prioricode",
  discord: "https://prioricode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
