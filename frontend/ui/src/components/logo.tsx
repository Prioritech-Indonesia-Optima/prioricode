import { type ComponentProps, type JSX } from "solid-js"
import markInk from "../assets/brand/mark-ink.png"
import markWhite from "../assets/brand/mark-white.png"
import wordmarkInk from "../assets/brand/wordmark-ink.png"
import wordmarkWhite from "../assets/brand/wordmark-white.png"

type BrandImageProps = {
  class?: string
  ref?: (el: HTMLImageElement) => void
  component: string
  white: string
  ink: string
  alt: string
}

function BrandImage(props: BrandImageProps): JSX.Element {
  const shared = {
    alt: props.alt,
    draggable: false,
    "data-component": props.component,
    ref: props.ref,
  } as const
  const klass = props.class ?? ""
  return (
    <>
      <img src={props.white} {...shared} class={`pc-brand-scheme-dark ${klass}`} />
      <img src={props.ink} {...shared} class={`pc-brand-scheme-light ${klass}`} />
    </>
  )
}

export const Mark = (props: { class?: string }) => {
  return <BrandImage class={props.class} component="logo-mark" white={markWhite} ink={markInk} alt="PrioriCode" />
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <BrandImage
      class={props.class as string | undefined}
      ref={props.ref as ((el: HTMLImageElement) => void) | undefined}
      component="logo-splash"
      white={markWhite}
      ink={markInk}
      alt="PrioriCode"
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <BrandImage
      class={props.class}
      component="logo-wordmark"
      white={wordmarkWhite}
      ink={wordmarkInk}
      alt="PrioriCode"
    />
  )
}
