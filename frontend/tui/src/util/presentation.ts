import { go, tone, type Tone } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const colors: Record<Tone, string> = {
  space: "",
  light: dim,
  base: reset,
  accent: "\x1b[38;5;214m",
  text: bold,
}

function mark(pad: string) {
  return go.right.map((line) => {
    const parts = [pad]
    let current: Tone | undefined
    for (const char of line) {
      const kind = tone(char)
      if (kind === "space") {
        current = undefined
        parts.push(" ")
        continue
      }
      if (kind !== current) {
        parts.push(colors[kind])
        current = kind
      }
      parts.push(char)
    }
    parts.push(reset)
    return parts.join("")
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...mark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}prioricode -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
