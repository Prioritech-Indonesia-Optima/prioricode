# @prioricode/ide-chat

The prioricode chat frontend for editor webviews. One self-contained bundle
(`dist/ide-chat.js` + `dist/ide-chat.css`, no runtime dependencies beyond the
browser) that renders a session transcript, prompt composer, permission cards,
and question cards.

Host-agnostic by design: the package never touches the network. Embedders
provide a `ChatTransport`-style wiring layer — in VS Code (`sdks/vscode`) the
extension host owns HTTP/SSE/auth and bridges `ChatState` snapshots in and
`Intent` messages out over `postMessage`.

```ts
const chat = window.PrioriCodeChat.mount(root, { direction: "ltr" })
chat.onIntent((intent) => host.postMessage(intent))
host.onMessage((state) => chat.render(state))
```

## Behavior notes

- All model text is rendered through a minimal markdown renderer that escapes
  HTML and only allows http(s) links; nothing is inserted via innerHTML
  unescaped.
- Direction is independent of language: the container follows `dir` (RTL
  locales, host hint, or explicit option), message text is `dir="auto"`, and
  code/paths/URLs stay LTR-isolated. Layout uses CSS logical properties only.
- Image paste is handled in the webview (`paste` event + file picker), sniffed
  by magic bytes, and capped client-side (`maxImageBytes`, default 3.5 MB)
  because the server stores prompt attachments verbatim.
- Transcript re-renders preserve composer text, tool/shell open-collapsed
  state, question drafts, and locally held image copies.

## Development

```sh
bun install
bun run build      # emits dist/ide-chat.js + dist/ide-chat.css
bun run check-types
bun test src       # markdown safety, paste policy, DOM behavior (happy-dom)
```
