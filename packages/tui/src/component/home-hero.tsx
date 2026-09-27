import { FrameBufferRenderable, type OptimizedBuffer, type RenderContext, type RenderableOptions } from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { HERO_H, HERO_W, HomeHeroPainter, type HomeHeroThemeColors } from "./home-hero-render"

// NOTE: the solid renderer's setProperty intercepts the JSX attribute names
// "text" and "content" for every renderable and stringifies their values
// before assigning them. Custom renderables must never expose those prop
// names — theme colors therefore arrive as textColor/mutedColor. (Passing
// `text={theme.text}` crashed v0.1.11 startup: the painter received
// "[object Object]" and RGBA.toInts threw inside setTheme.)
type HomeHeroOptions = RenderableOptions<FrameBufferRenderable> & {
  background?: HomeHeroThemeColors["background"]
  primary?: HomeHeroThemeColors["primary"]
  textColor?: HomeHeroThemeColors["text"]
  mutedColor?: HomeHeroThemeColors["textMuted"]
}

class HomeHeroRenderable extends FrameBufferRenderable {
  private painter = new HomeHeroPainter()

  constructor(ctx: RenderContext, options: HomeHeroOptions = {}) {
    super(ctx, {
      ...options,
      width: HERO_W,
      height: HERO_H,
      live: options.live ?? true,
      respectAlpha: false,
    })
    this.painter.setTheme({
      background: options.background,
      primary: options.primary,
      text: options.textColor,
      textMuted: options.mutedColor,
    })
  }

  set background(value: HomeHeroOptions["background"]) {
    if (this.painter.setTheme({ background: value })) this.requestRender()
  }

  set primary(value: HomeHeroOptions["primary"]) {
    if (this.painter.setTheme({ primary: value })) this.requestRender()
  }

  set textColor(value: HomeHeroOptions["textColor"]) {
    if (this.painter.setTheme({ text: value })) this.requestRender()
  }

  set mutedColor(value: HomeHeroOptions["mutedColor"]) {
    if (this.painter.setTheme({ textMuted: value })) this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return
    this.painter.render(this.frameBuffer, { deltaTime })
    super.renderSelf(buffer)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    home_hero: typeof HomeHeroRenderable
  }
}

extend({ home_hero: HomeHeroRenderable })

export function HomeHero() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  let targetFps = renderer.targetFps
  let maxFps = renderer.maxFps

  onMount(() => {
    targetFps = renderer.targetFps
    maxFps = renderer.maxFps
    renderer.targetFps = 30
    renderer.maxFps = 30
  })

  onCleanup(() => {
    renderer.targetFps = targetFps
    renderer.maxFps = maxFps
  })

  return (
    <home_hero
      width={HERO_W}
      height={HERO_H}
      background={theme.background}
      primary={theme.primary}
      textColor={theme.text}
      mutedColor={theme.textMuted}
      live
    />
  )
}
