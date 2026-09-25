// Grainy ASCII rendition of the Prioritech mark for the home screen, CLI
// banners, and exit epilogues.
//
// Regenerated from the official logo asset with
//   bun script/logo-ascii.ts branding/prioritech-mark.png 42
// (see that file for the color-aware density mapping). The mark reads as: a
// 4-point sparkle star at the top-left, an amber swoosh arcing down through a
// bold geometric "P" and exiting at the bottom, with the "PrioriCode"
// wordmark beside it. Each character class carries its own tone:
//   light  `. , : '`  anti-aliased edges and stipple
//   base   `| / \ - _ # % @ &`  the P body and outline strokes
//   accent `* +`      the swoosh and star (rendered in the brand color)
//   text   anything else (wordmark letters)
export const logo = {
  left: [
    ".+.++                                     ",
    " .***+                                    ",
    "  ++.++***%%##########################%:  ",
    "      %%%******%%#######################%.",
    "      ..... ++****+:...............::#####",
    "               .+****+.              %####",
    "             :%%%%%*****+.%%%%%%%%%%#####%",
    "             %######%+****+%############: ",
    "             %####%%%%:+****+%%%%%%%%%:   ",
    "             %####  :%%%:****+.%%%%%%:    ",
    "             %####  %####.****+%#####%    ",
    "             %###%  %%%%%:+****+%%%%%:    ",
    "                          .****+          ",
    "                           ****+          ",
    "                           ****+          ",
    "                           ****+          ",
  ],
  right: ["", "", "", "", "", "", "", "", "PrioriCode", "", "", "", "", "", "", ""],
}

// Compact mark used by the run-mode splash badge and the pulsing upsell
// panel. Row zero stays blank: the splash slices it off as top padding.
export const go = {
  left: ["", "", "", "", "", "", "", "", ""],
  right: [
    "                    ",
    ".*+                 ",
    " ..%**#############:",
    "   .. +***+......:##",
    "      %###**+%#####%",
    "      %#%:%+**%%%%. ",
    "      %#::##+**##%  ",
    "            .**     ",
    "            .**     ",
  ],
}

// Oversized block-letter "PrioriCode" wordmark for the home hero, rendered as
// full-block cells with a horizontal amber→text gradient and a soft glow band.
// 5x7 pixel glyphs per letter, one blank column between letters (59 columns).
export const big = [
  "████          █                 █    ████          █",
  "█   █ █ ██         ███  █ ██        █      ███     █   ███",
  "█   █ ██  █  ██   █   █ ██  █  ██   █     █   █  █ █  █   █",
  "████  █       █   █   █ █       █   █     █   █ █ ██  █████",
  "█     █       █   █   █ █       █   █     █   █ █  █  █",
  "█     █       █   █   █ █       █   █     █   █ █  █  █",
  "█     █      ███   ███  █      ███   ████  ███   ██ █  ███",
]

export type Tone = "space" | "light" | "base" | "accent" | "text"

const LIGHT = new Set([".", ",", ":", "'"])
const BASE = new Set(["|", "/", "\\", "-", "_", "#", "%", "@", "&"])
const ACCENT = new Set(["*", "+"])

export function tone(char: string): Tone {
  if (char === " ") return "space"
  if (LIGHT.has(char)) return "light"
  if (BASE.has(char)) return "base"
  if (ACCENT.has(char)) return "accent"
  return "text"
}
