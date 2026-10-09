import type { CellBuffer } from "../render/cell"
import { NO_COLOR } from "../render/cell"

// Cell-buffer vignette compatible in spirit with OpenTUI's VignetteEffect:
// attenuates toward black by a radial falloff from screen center. OpenTUI's
// 0.4.5 implementation runs a native colorMatrix with a precomputed mask;
// this is the JS equivalent on the tui-core cell grid.
export class VignetteEffect {
  private strength: number

  constructor(strength = 0.5) {
    this.strength = Math.max(0, Math.min(1, strength))
  }

  setStrength(value: number): void {
    this.strength = Math.max(0, Math.min(1, value))
  }

  getStrength(): number {
    return this.strength
  }

  apply = (buffer: CellBuffer, _deltaTime = 0): void => {
    if (this.strength <= 0) return
    const { width, height } = buffer
    const cx = (width - 1) / 2
    const cy = (height - 1) / 2
    const maxDistance = Math.sqrt(cx * cx + cy * cy) || 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx
        const dy = (y - cy) * 2
        const distance = Math.sqrt(dx * dx + dy * dy) / maxDistance
        const factor = 1 - this.strength * distance * distance
        if (factor >= 0.999) continue
        const cell = buffer.cells[y * width + x]
        buffer.cells[y * width + x] = {
          text: cell.text,
          attrs: cell.attrs,
          fg: attenuate(cell.fg, factor),
          bg: attenuate(cell.bg, factor),
        }
      }
    }
  }
}

function attenuate(packed: number, factor: number): number {
  if (packed === NO_COLOR) return NO_COLOR
  const r = Math.round(((packed >> 16) & 0xff) * factor)
  const g = Math.round(((packed >> 8) & 0xff) * factor)
  const b = Math.round((packed & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}
