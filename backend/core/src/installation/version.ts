declare global {
  const PRIORICODE_VERSION: string
  const PRIORICODE_CHANNEL: string
}

export const InstallationVersion = typeof PRIORICODE_VERSION === "string" ? PRIORICODE_VERSION : "local"
export const InstallationChannel = typeof PRIORICODE_CHANNEL === "string" ? PRIORICODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

export const ProductVersion = InstallationVersion
