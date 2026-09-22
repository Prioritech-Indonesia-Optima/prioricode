// Prioritech brand primitives for the landing page.
//
// The ASCII art mirrors packages/tui/src/logo.ts (the CLI source of truth),
// rasterized from the vector mark in /branding. Keep both in sync when the
// mark changes.

export const ascii = [
  ".+.++",
  " .***+",
  "  ++.++***%%##########################%:",
  "      %%%******%%#######################%.",
  "      ..... ++****+:...............::#####",
  "               .+****+.              %####",
  "             :%%%%%*****+.%%%%%%%%%%#####%",
  "             %######%+****+%############:",
  "             %####%%%%:+****+%%%%%%%%%:",
  "             %####  :%%%:****+.%%%%%%:",
  "             %####  %####.****+%#####%",
  "             %###%  %%%%%:+****+%%%%%:",
  "                          .****+",
  "                           ****+",
  "                           ****+",
  "                           ****+"
]

export type Tone = "light" | "base" | "accent"

export function tone(char: string): Tone {
  if (".,:'".includes(char)) return "light"
  if ("*+".includes(char)) return "accent"
  return "base"
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <path id="prio-swoosh" d="M16 18C38 29 54 42 56 60L56 90L70 90L70 60C70 40 50 26 21 11Z" />
        <path id="prio-star" d="M13 4Q13 16 25 16Q13 16 13 28Q13 16 1 16Q13 16 13 4Z" transform="rotate(15 13 16)" />
        <mask id="prio-gap">
          <rect width="100" height="100" fill="#fff" />
          <use href="#prio-swoosh" fill="#000" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
          <use href="#prio-star" fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
        </mask>
      </defs>
      <path
        mask="url(#prio-gap)"
        fill="var(--logo-p)"
        fillRule="evenodd"
        d="M24 14H62C77 14 88 24 88 36C88 48 77 58 62 58H39V82H24ZM39 27H60C68 27 74 31 74 36C74 41 68 45 60 45H39Z"
      />
      <use href="#prio-swoosh" fill="var(--logo-amber)" />
      <use href="#prio-star" fill="var(--logo-amber)" />
    </svg>
  )
}
