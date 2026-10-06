import type { V2ColorValue } from "../types"
import { V2_AVATAR_DARK, V2_AVATAR_LIGHT } from "./avatar"

const ref = (name: string): V2ColorValue => `var(--${name})`

const lightAgentTokens: Record<string, V2ColorValue> = {
  "pc-agent-plan-solid": ref("pc-pink-800"),
  "pc-agent-plan-border": "rgba(200, 61, 139, 0.20)",
  "pc-agent-plan-background": "rgba(253, 236, 243, 0.10)",
  "pc-agent-build-solid": ref("pc-blue-800"),
  "pc-agent-build-border": "rgba(3, 63, 214, 0.14)",
  "pc-agent-build-background": "rgba(234, 240, 255, 0.12)",
  "pc-agent-explore-solid": ref("pc-yellow-900"),
  "pc-agent-explore-border": "rgba(203, 159, 52, 0.20)",
  "pc-agent-explore-background": "rgba(254, 250, 236, 0.1)",
  "pc-agent-review-solid": ref("pc-green-800"),
  "pc-agent-writer-solid": ref("pc-purple-700"),
}

const darkAgentTokens: Record<string, V2ColorValue> = {
  "pc-agent-plan-solid": ref("pc-pink-400"),
  "pc-agent-plan-border": "rgba(247, 153, 198, 0.20)",
  "pc-agent-plan-background": "rgba(170, 53, 118, 0.05)",
  "pc-agent-build-solid": ref("pc-blue-300"),
  "pc-agent-build-border": "rgba(181, 204, 255, 0.20)",
  "pc-agent-build-background": "rgba(11, 43, 116, 0.08)",
  "pc-agent-explore-solid": ref("pc-yellow-300"),
  "pc-agent-explore-border": "rgba(243, 218, 155, 0.20)",
  "pc-agent-explore-background": "rgba(172, 136, 51, 0.05)",
  "pc-agent-review-solid": ref("pc-green-300"),
  "pc-agent-writer-solid": ref("pc-purple-400"),
}

const light: Record<string, V2ColorValue> = {
  "pc-bg-base": ref("pc-grey-50"),
  "pc-bg-deep": ref("pc-grey-100"),
  "pc-bg-layer-01": ref("pc-grey-200"),
  "pc-bg-layer-02": ref("pc-grey-300"),
  "pc-bg-layer-03": ref("pc-grey-400"),
  "pc-bg-layer-04": ref("pc-grey-500"),
  "pc-bg-inverse": ref("pc-grey-1100"),
  "pc-bg-contrast": ref("pc-grey-1000"),
  "pc-bg-button-neutral": ref("pc-grey-50"),
  "pc-bg-accent": ref("pc-gold-600"),
  "pc-bg-brand": ref("pc-gold-400"),
  "pc-bg-brand-soft": ref("pc-gold-100"),
  "pc-text-on-brand": ref("pc-grey-1200"),
  "pc-text-brand": ref("pc-gold-900"),
  "pc-icon-brand": ref("pc-gold-800"),
  "pc-border-brand": ref("pc-gold-700"),
  "pc-text-inverse": ref("pc-grey-50"),
  "pc-text-contrast": ref("pc-grey-50"),
  "pc-text-accent": ref("pc-gold-800"),
  "pc-text-accent-hover": ref("pc-gold-900"),
  "pc-text-code-accent": ref("pc-blue-800"),
  "pc-border-muted": ref("pc-alpha-dark-14"),
  "pc-border-base": ref("pc-alpha-dark-18"),
  "pc-border-strong": ref("pc-alpha-dark-26"),
  "pc-border-inverse": ref("pc-grey-1000"),
  "pc-border-focus": ref("pc-gold-600"),
  "pc-overlay-hover": ref("pc-alpha-dark-6"),
  "pc-overlay-pressed": ref("pc-alpha-dark-12"),
  "pc-overlay-contrast-hover": ref("pc-alpha-light-12"),
  "pc-overlay-contrast-pressed": ref("pc-alpha-light-24"),
  "pc-overlay-scrim": ref("pc-alpha-dark-50"),
  "pc-depth-top": ref("pc-alpha-light-100"),
  "pc-depth-bot": ref("pc-alpha-light-0"),
  "pc-tab-active-scrim": "#f7f6ef00",
  "pc-tab-hover-scrim": "#e5e3d700",
  "pc-tab-scrim": "#f7f6ef00",
  "pc-state-bg-success": ref("pc-green-100"),
  "pc-state-fg-success": ref("pc-green-800"),
  "pc-state-border-success": ref("pc-green-300"),
  "pc-state-bg-warning": ref("pc-yellow-100"),
  "pc-state-fg-warning": ref("pc-yellow-800"),
  "pc-state-border-warning": ref("pc-yellow-300"),
  "pc-state-bg-danger": ref("pc-red-100"),
  "pc-state-fg-danger": ref("pc-red-800"),
  "pc-state-border-danger": ref("pc-red-300"),
  "pc-state-bg-info": ref("pc-blue-100"),
  "pc-state-fg-info": ref("pc-blue-800"),
  "pc-state-border-info": ref("pc-blue-300"),
  ...lightAgentTokens,
  ...V2_AVATAR_LIGHT,
  "pc-elevation-raised":
    "0px 2px 5px 0px var(--pc-alpha-dark-8), 0px 1px 2px -1px var(--pc-alpha-dark-14), 0px 0px 0px 0.5px var(--pc-alpha-dark-16), 0px 0px 0px 0px var(--pc-alpha-dark-0)",
  "pc-elevation-floating":
    "0px 10px 22px 0px var(--pc-alpha-dark-10), 0px 3px 8px 0px var(--pc-alpha-dark-14), 0px 0px 0px 0.5px var(--pc-alpha-dark-16), 0px 0px 0px 0px var(--pc-alpha-dark-0)",
  "pc-elevation-overlay":
    "0px 18px 40px 0px var(--pc-alpha-dark-14), 0px 6px 14px 0px var(--pc-alpha-dark-14), 0px 0px 0px 0.5px var(--pc-alpha-dark-18), 0px 0px 0px 0px var(--pc-alpha-dark-0)",
  "pc-elevation-button-neutral":
    "0px 1px 2px 0px var(--pc-alpha-dark-14), 0px 0px 0px 0.5px var(--pc-alpha-dark-18), 0px 0px 0px 0px var(--pc-alpha-dark-0)",
  "pc-elevation-button-contrast":
    "0px 1px 2px 0px var(--pc-alpha-dark-24), 0px 0px 0px 0.5px var(--pc-gold-700), inset 0px 1px 2px 0px var(--pc-alpha-light-24), inset 0px -1px 2px 0px var(--pc-alpha-dark-8), 0px 0px 0px 0px var(--pc-alpha-dark-0)",
  "pc-elevation-elements": "0px 0.5px 0.5px 0px var(--pc-alpha-dark-50)",
  "pc-elevation-switch-off":
    "inset 0px 1px 1px 0px var(--pc-alpha-dark-12), inset 0px 0.5px 0.5px 0px var(--pc-alpha-dark-12), inset 0px 0px 0px 0.5px var(--pc-alpha-dark-18)",
  "pc-elevation-switch-on":
    "inset 0px 2px 2px 0px var(--pc-alpha-dark-14), inset 0px 1px 1px 0px var(--pc-alpha-dark-14), inset 0px 0px 0px 0.5px var(--pc-alpha-dark-24)",
  "pc-illustration-layer-01": ref("pc-grey-300"),
  "pc-illustration-layer-02": ref("pc-grey-400"),
  "pc-illustration-layer-03": ref("pc-grey-500"),
}

const dark: Record<string, V2ColorValue> = {
  "pc-bg-base": ref("pc-grey-1000"),
  "pc-bg-deep": ref("pc-grey-1100"),
  "pc-bg-layer-01": ref("pc-grey-900"),
  "pc-bg-layer-02": ref("pc-grey-800"),
  "pc-bg-layer-03": ref("pc-grey-700"),
  "pc-bg-layer-04": ref("pc-grey-600"),
  "pc-bg-inverse": ref("pc-grey-50"),
  "pc-bg-contrast": ref("pc-grey-700"),
  "pc-bg-button-neutral": ref("pc-alpha-light-8"),
  "pc-bg-accent": ref("pc-gold-600"),
  "pc-bg-brand": ref("pc-gold-400"),
  "pc-bg-brand-soft": ref("pc-gold-1100"),
  "pc-text-on-brand": ref("pc-grey-1200"),
  "pc-text-brand": ref("pc-gold-300"),
  "pc-icon-brand": ref("pc-gold-300"),
  "pc-border-brand": ref("pc-gold-500"),
  "pc-text-inverse": ref("pc-grey-1100"),
  "pc-text-contrast": ref("pc-grey-50"),
  "pc-text-accent": ref("pc-gold-300"),
  "pc-text-accent-hover": ref("pc-gold-200"),
  "pc-text-code-accent": ref("pc-blue-400"),
  "pc-border-muted": ref("pc-alpha-light-14"),
  "pc-border-base": ref("pc-alpha-light-18"),
  "pc-border-strong": ref("pc-alpha-light-26"),
  "pc-border-inverse": ref("pc-grey-100"),
  "pc-border-focus": ref("pc-gold-500"),
  "pc-overlay-hover": ref("pc-alpha-light-8"),
  "pc-overlay-pressed": ref("pc-alpha-light-14"),
  "pc-overlay-contrast-hover": ref("pc-alpha-dark-24"),
  "pc-overlay-contrast-pressed": ref("pc-alpha-dark-40"),
  "pc-overlay-scrim": ref("pc-alpha-dark-60"),
  "pc-depth-top": ref("pc-alpha-light-100"),
  "pc-depth-bot": ref("pc-alpha-light-0"),
  "pc-tab-active-scrim": "#2a282300",
  "pc-tab-hover-scrim": "#47453d00",
  "pc-tab-scrim": "#100f0d00",
  "pc-state-bg-success": ref("pc-green-1200"),
  "pc-state-fg-success": ref("pc-green-500"),
  "pc-state-border-success": ref("pc-green-900"),
  "pc-state-bg-warning": ref("pc-yellow-1200"),
  "pc-state-fg-warning": ref("pc-yellow-500"),
  "pc-state-border-warning": ref("pc-yellow-900"),
  "pc-state-bg-danger": ref("pc-red-1200"),
  "pc-state-fg-danger": ref("pc-red-500"),
  "pc-state-border-danger": ref("pc-red-900"),
  "pc-state-bg-info": ref("pc-blue-1200"),
  "pc-state-fg-info": ref("pc-blue-400"),
  "pc-state-border-info": ref("pc-blue-900"),
  ...darkAgentTokens,
  ...V2_AVATAR_DARK,
  "pc-elevation-raised":
    "0px 2px 5px 0px var(--pc-alpha-dark-40), 0px 1px 2px 0px var(--pc-alpha-dark-30), 0px 0px 0px 0.5px var(--pc-alpha-light-20), 0px -0.5px 0px 0px var(--pc-alpha-light-8)",
  "pc-elevation-floating":
    "0px 10px 22px 0px var(--pc-alpha-dark-40), 0px 3px 8px 0px var(--pc-alpha-dark-30), 0px 0px 0px 0.5px var(--pc-alpha-light-20), 0px -0.5px 0px 0px var(--pc-alpha-light-8)",
  "pc-elevation-overlay":
    "0px 18px 40px 0px var(--pc-alpha-dark-50), 0px 6px 14px 0px var(--pc-alpha-dark-30), 0px 0px 0px 0.5px var(--pc-alpha-light-20), 0px -0.5px 0px 0px var(--pc-alpha-light-8)",
  "pc-elevation-button-neutral":
    "0px 1px 2px 0px var(--pc-alpha-dark-40), 0px 0px 0px 0.5px var(--pc-alpha-light-24), 0px -0.5px 0px 0px var(--pc-alpha-light-12)",
  "pc-elevation-button-contrast":
    "0px 1px 2px 0px var(--pc-alpha-dark-40), 0px 0px 0px 0.5px var(--pc-alpha-light-40), inset 0px 0px 0px 0px var(--pc-alpha-light-0), inset 0px 0px 0px 0px var(--pc-alpha-light-0), 0px -0.5px 0px 0px var(--pc-alpha-light-30)",
  "pc-elevation-elements": "0px 0.5px 0.5px 0px var(--pc-alpha-dark-50)",
  "pc-elevation-switch-off":
    "inset 0px -0.5px 0px 0px var(--pc-alpha-light-12), inset 0px 0px 0px 0px var(--pc-alpha-light-0), inset 0px 0px 0px 0.5px var(--pc-alpha-light-20)",
  "pc-elevation-switch-on":
    "inset 0px -0.5px 0px 0px var(--pc-alpha-light-12), inset 0px 0px 0px 0px var(--pc-alpha-light-0), inset 0px 0px 0px 0.5px var(--pc-alpha-light-20)",
  "pc-illustration-layer-01": ref("pc-grey-900"),
  "pc-illustration-layer-02": ref("pc-grey-800"),
  "pc-illustration-layer-03": ref("pc-grey-700"),
}

export function mapV2Semantics(isDark: boolean): Record<string, V2ColorValue> {
  return isDark ? dark : light
}

export function mergeV2Tokens(...layers: Record<string, V2ColorValue>[]): Record<string, V2ColorValue> {
  return Object.assign({}, ...layers)
}

const legacySemanticNames: Record<string, string> = {
  "v2-background-bg-base": "pc-bg-base",
  "v2-background-bg-deep": "pc-bg-deep",
  "v2-background-bg-layer-01": "pc-bg-layer-01",
  "v2-background-bg-layer-02": "pc-bg-layer-02",
  "v2-background-bg-layer-03": "pc-bg-layer-03",
  "v2-background-bg-layer-04": "pc-bg-layer-04",
  "v2-background-bg-inverse": "pc-bg-inverse",
  "v2-background-bg-contrast": "pc-bg-contrast",
  "v2-background-bg-button-neutral": "pc-bg-button-neutral",
  "v2-background-bg-accent": "pc-bg-accent",
  "v2-text-text-base": "pc-text-base",
  "v2-text-text-muted": "pc-text-muted",
  "v2-text-text-faint": "pc-text-faint",
  "v2-text-text-inverse": "pc-text-inverse",
  "v2-text-text-contrast": "pc-text-contrast",
  "v2-text-text-accent": "pc-text-accent",
  "v2-text-text-accent-hover": "pc-text-accent-hover",
  "v2-text-text-code-accent": "pc-text-code-accent",
  "v2-icon-icon-base": "pc-icon-base",
  "v2-icon-icon-muted": "pc-icon-muted",
  "v2-icon-icon-inverse": "pc-icon-inverse",
  "v2-icon-icon-contrast": "pc-icon-contrast",
  "v2-icon-icon-accent": "pc-icon-accent",
  "v2-icon-icon-accent-hover": "pc-icon-accent-hover",
  "v2-border-border-muted": "pc-border-muted",
  "v2-border-border-base": "pc-border-base",
  "v2-border-border-strong": "pc-border-strong",
  "v2-border-border-inverse": "pc-border-inverse",
  "v2-border-border-focus": "pc-border-focus",
  "v2-overlay-simple-overlay-hover": "pc-overlay-hover",
  "v2-overlay-simple-overlay-pressed": "pc-overlay-pressed",
  "v2-overlay-simple-overlay-contrast-hover": "pc-overlay-contrast-hover",
  "v2-overlay-simple-overlay-contrast-pressed": "pc-overlay-contrast-pressed",
  "v2-overlay-simple-overlay-scrim": "pc-overlay-scrim",
  "v2-overlay-gradient-depth-overlay-depth-top": "pc-depth-top",
  "v2-overlay-gradient-depth-overlay-depth-bot": "pc-depth-bot",
  "v2-overlay-simple-tab-active-scrim": "pc-tab-active-scrim",
  "v2-overlay-simple-tab-hover-scrim": "pc-tab-hover-scrim",
  "v2-overlay-simple-tab-scrim": "pc-tab-scrim",
  "v2-illustration-illustration-layer-01": "pc-illustration-layer-01",
  "v2-illustration-illustration-layer-02": "pc-illustration-layer-02",
  "v2-illustration-illustration-layer-03": "pc-illustration-layer-03",
  "v2-font-family-sans": "pc-font-sans",
}

function migrateV2Name(name: string): string {
  if (legacySemanticNames[name]) return legacySemanticNames[name]
  return name.startsWith("v2-") ? "pc-" + name.slice(3) : name
}

function migrateV2Value(value: V2ColorValue): V2ColorValue {
  if (typeof value !== "string" || !value.includes("v2-")) return value
  return value.replace(/v2-[a-z0-9-]+/g, (m) => legacySemanticNames[m] ?? "pc-" + m.slice(3)) as V2ColorValue
}

/** Pre-block custom themes carry `v2-*` override keys; accept them and migrate forward. */
export function migrateV2Overrides(overrides: Record<string, V2ColorValue> | undefined): Record<string, V2ColorValue> {
  if (!overrides) return {}
  return Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [migrateV2Name(key), migrateV2Value(value)]),
  )
}
