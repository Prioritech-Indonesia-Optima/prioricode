export type GuiHost = "web" | "vscode"

export function detectHost(search: string = globalThis.location?.search ?? "", win: object = globalThis): GuiHost {
  if (typeof (win as { acquireVsCodeApi?: unknown }).acquireVsCodeApi === "function") return "vscode"
  return new URLSearchParams(search).get("host") === "vscode" ? "vscode" : "web"
}
