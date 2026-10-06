/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://prioricode.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/Prioritech-Indonesia-Optima/prioricode",
    starsFormatted: {
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/prioricode",
    discord: "https://discord.gg/prioricode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
