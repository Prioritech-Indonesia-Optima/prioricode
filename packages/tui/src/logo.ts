// Grainy ASCII rendition of the Prioritech mark for the home screen, CLI
// banners, and exit epilogues.
//
// The mark is rasterized from the vector brand asset: a 4-point sparkle star
// at the top-left, an amber swoosh arcing down through a geometric "P".
// Density is encoded in thin characters instead of solid blocks, and each
// character class carries its own tone (see `tone`):
//   light  `. , : '`  stippled interior shading
//   base   `| / \ -`  outline strokes
//   accent `* +`      the swoosh and star (rendered in the brand color)
//   text   anything else (wordmark letters)
export const logo = {
  left: [
    " .+*+++.",
    " .***+***+.    ------\\",
    "  .+  .+*****+   ---\\\\-\\",
    "          +****+    \\ :\\",
    "       |\\   +****+  /\\ \\/",
    "       |\\\\\\   *****  \\-/",
    "       |  \\--  ****+ -",
    "       |: |    +****",
    "       | :|    +****",
    "       |\\\\|    +****",
    "               +****",
    "               .***+",
  ].map((row) => row.padEnd(25)),
  right: ["", "", "", "", "", "", "PrioriCode", "", "", "", "", ""],
}

// Compact mark used by the run-mode splash badge and the pulsing upsell
// panel. Row zero stays blank: the splash slices it off as top padding.
export const go = {
  left: ["", "", "", "", "", "", "", "", "", ""],
  right: [
    "             ",
    "  .          ",
    " +*+*++    --",
    " .  .+***+   \\-",
    "       .***+  \\/",
    "    |\\   +**+ /",
    "    |\\|   ***  ",
    "    |\\|   ***  ",
    "          ***  ",
    "          ...  ",
  ],
}

export type Tone = "space" | "light" | "base" | "accent" | "text"

const LIGHT = new Set([".", ",", ":", "'"])
const BASE = new Set(["|", "/", "\\", "-"])
const ACCENT = new Set(["*", "+"])

export function tone(char: string): Tone {
  if (char === " ") return "space"
  if (LIGHT.has(char)) return "light"
  if (BASE.has(char)) return "base"
  if (ACCENT.has(char)) return "accent"
  return "text"
}
