import { useLanguage } from "@/context/language"

export function HomeHero(props: { language: ReturnType<typeof useLanguage> }) {
  return (
    <header
      data-component="home-hero"
      class="shrink-0 px-1 pt-2 pb-1 lg:pt-4"
      aria-label={props.language.t("home.title")}
    >
      <div class="flex items-center gap-2">
        <span aria-hidden="true" class="size-2 bg-pc-gold-500" />
        <span class="font-mono text-[11px] uppercase tracking-[0.22em] text-pc-text-accent">
          {props.language.t("home.hero.eyebrow")}
        </span>
      </div>
      <h1 class="mt-3 text-[28px] font-semibold leading-[1.08] tracking-[-0.02em] text-pc-text-base">
        {props.language.t("home.hero.title")}
      </h1>
      <p class="mt-2 max-w-[52ch] text-[14px] leading-5 text-pc-text-muted">{props.language.t("home.hero.subtitle")}</p>
    </header>
  )
}
