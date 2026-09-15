// Block wordmark for the home screen, CLI banners, and exit epilogues.
//
// Four rows tall, ANSI-Compact style, mirroring the blocky PrioriCode logo.
// Left half ("PRIORI") renders dim, right half ("CODE") renders bold. The
// renderer marks are: `_` shadowed interior, `^` fg top half on shadow bg,
// `~` shadow top half, `,` shadow bottom half. Plain `█ ▀ ▄` render in the
// foreground color.
export const logo = {
  left: ["█▀▀█ █▀▀█ █ █▀▀█ █▀▀█ █", "█▀▀█ █▄▄▀ █ █__█ █▄▄▀ █", "█    █  █ █ █__█ █  █ █", "▀    ▀  ▀ ▀ ▀▀▀▀ ▀  ▀ ▀"],
  right: ["█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀", "█    █__█ █__█ █▀▀ ", "█    █__█ █__█ █   ", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
