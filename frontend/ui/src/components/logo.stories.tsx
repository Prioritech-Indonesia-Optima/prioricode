// @ts-nocheck
import * as mod from "./logo"

const docs = `### Overview
PrioriCode logo assets: mark, splash, and wordmark.

Use Mark for compact spaces, Logo for headers, Splash for hero sections.

### API
- \`Mark\` and \`Logo\` accept a \`class\` prop; \`Splash\` accepts \`class\` and \`ref\`.

### Variants and states
- Multiple logo variants for different contexts.

### Behavior
- Raster rendering from generated brand assets; the light scheme swaps to
  ink-colored variants via \`html[data-color-scheme]\`.

### Accessibility
- Images carry a "PrioriCode" alt label.

### Theming/tokens
- White art on dark schemes, ink art on light schemes.

`

export default {
  title: "UI/Logo",
  id: "components-logo",
  component: mod.Logo,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "grid", gap: "16px", "align-items": "start" }}>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Mark</div>
        <mod.Mark />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Splash</div>
        <div style={{ width: "80px", height: "100px" }}>
          <mod.Splash class="h-full w-full" />
        </div>
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Logo</div>
        <mod.Logo class="w-[200px]" />
      </div>
    </div>
  ),
}
