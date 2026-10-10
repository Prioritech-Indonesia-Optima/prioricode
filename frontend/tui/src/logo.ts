// Grainy ASCII rendition of the Prioritech mark for the home screen, CLI
// banners, and exit epilogues.
//
// Regenerated from the generated brand mark with
//   bun script/logo-ascii.ts frontend/ui/src/assets/brand/mark-white.png 42
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
    "#######% ++++++.",
    "#######% +#*+*****++++.",
    "#######% +##**************++++.",
    "#######% +*#*********************++++.",
    "#######%   ++**************************++.",
    "#######%       +++************************",
    "#######%              .++*****************",
    "#######%                .+****************",
    "#######%             ++*******************",
    "#######%         .+*********************+.",
    "#######%     .+*********************++",
    "#######%  ++*********************+.",
    "#######% +*******************+.",
    "#######% +#*+*************+",
    "#######% +##**********+.",
    "#######% +*#******++",
    "#######%   ++**+.",
  ],
  right: ["", "", "", "", "", "", "", "", "PrioriCode", "", "", "", "", "", "", "", ""],
}

export const go = {
  left: [
    "",
    "###%+*++++.",
    "###%+*********+++.",
    "###%  ++************",
    "###%       +********",
    "###%   .+**********+",
    "###%.**********++",
    "###%+*******+",
    "###%.***+.",
  ],
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

export const big = [
  "████          █                 █    ████          █",
  "█   █ █ ██         ███  █ ██        █      ███     █   ███",
  "█   █ ██  █  ██   █   █ ██  █  ██   █     █   █  █ █  █   █",
  "████  █       █   █   █ █       █   █     █   █ █ ██  █████",
  "█     █       █   █   █ █       █   █     █   █ █  █  █",
  "█     █       █   █   █ █       █   █     █   █ █  █  █",
  "█     █      ███   ███  █      ███   ████  ███   ██ █  ███",
]

// Brand tagline shown beneath the home hero wordmark. Part of the brand art,
// intentionally kept byte-for-byte identical across locales.
export const tagline = "the open source AI coding agent"

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
