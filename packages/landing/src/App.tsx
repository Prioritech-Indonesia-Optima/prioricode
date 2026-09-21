import { useEffect, useState } from "react"
import { ascii, Mark, tone } from "./brand"

const GITHUB = "https://github.com/Prioritech-Indonesia-Optima/prioricode"

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark")
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("prioricode-theme", theme)
    } catch {}
  }, [theme])
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const
}

function AsciiLogo() {
  let order = 0
  return (
    <pre className="ascii" aria-hidden="true">
      {ascii.map((row, y) => (
        <span className="ascii-row" key={y}>
          {Array.from(row).map((char, x) =>
            char === " " ? (
              <span key={x}> </span>
            ) : (
              <span
                key={x}
                className={`c-${tone(char)}`}
                style={{ animationDelay: `${0.15 + 0.012 * order++ + y * 0.04}s` }}
              >
                {char}
              </span>
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  )
}

function Install() {
  const [target, setTarget] = useState<"sh" | "ps">(() =>
    /win/i.test(navigator.userAgent + " " + (navigator as { platform?: string }).platform) ? "ps" : "sh",
  )
  const [copied, setCopied] = useState(false)
  const commands = {
    sh: "curl -fsSL https://code.prioritech.co.id/install | bash",
    ps: "irm https://code.prioritech.co.id/install.ps1 | iex",
  }
  return (
    <div className="install" id="install">
      <div className="tabs" role="tablist" aria-label="Choose your platform">
        <button
          role="tab"
          aria-selected={target === "sh"}
          onClick={() => setTarget("sh")}
          className={target === "sh" ? "on" : ""}
        >
          macOS &amp; Linux
        </button>
        <button
          role="tab"
          aria-selected={target === "ps"}
          onClick={() => setTarget("ps")}
          className={target === "ps" ? "on" : ""}
        >
          Windows
        </button>
      </div>
      <div className="cmd">
        <span className="prompt">{target === "sh" ? "$" : ">"}</span>
        <code>{commands[target]}</code>
        <button
          className={"copy" + (copied ? " done" : "")}
          aria-label="Copy install command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(commands[target])
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="hint">
        Installs the latest release. Pin a version with <code>-- --version 0.1.1</code>.
      </p>
    </div>
  )
}

function Version() {
  const [tag, setTag] = useState("v0.1.1")
  useEffect(() => {
    fetch(`${GITHUB.replace("github.com", "api.github.com/repos")}/releases/latest`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.tag_name && setTag(d.tag_name.replace(/^v/, "")))
      .catch(() => {})
  }, [])
  return (
    <a className="ver" href={`${GITHUB}/releases/latest`}>
      v{tag}
    </a>
  )
}

const FEATURES = [
  {
    title: "Terminal-native",
    body: "Runs where you work. No context switch, no IDE lock-in — just a conversation that writes real code.",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
        <path d="M4 6l2.5 2L4 10M8.5 10.5H12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Open source",
    body: "Fully transparent agent, tools, and context engine. Read it, fork it, ship it — MIT-style and yours.",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 1.5 2 4.5v4c0 3 2.5 5.3 6 6 3.5-.7 6-3 6-6v-4L8 1.5Z" strokeLinejoin="round" />
        <path d="M5.5 8 7.2 9.7 10.8 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Model-agnostic",
    body: "Switch providers and models per session. Your agent, your keys, no lock-in to any single lab.",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M1.5 8h13M8 1.5c1.8 2 2.7 4.2 2.7 6.5S9.8 12.5 8 14.5C6.2 12.5 5.3 10.3 5.3 8 5.3 5.7 6.2 3.5 8 1.5Z" />
      </svg>
    ),
  },
  {
    title: "Built in Jakarta",
    body: "Crafted by Prioritech Indonesia Optima — progress, precision, priority. Shipped daily, in the open.",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 14.5s5.5-4.6 5.5-8A5.5 5.5 0 0 0 2.5 6.5c0 3.4 5.5 8 5.5 8Z" strokeLinejoin="round" />
        <circle cx="8" cy="6.5" r="2" />
      </svg>
    ),
  },
]

export function App() {
  const [theme, flip] = useTheme()
  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <svg className="comet" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="cometGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f9b110" stopOpacity="0" />
              <stop offset="0.55" stopColor="#f9b110" stopOpacity="0.5" />
              <stop offset="1" stopColor="#ffc94a" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path className="trail" d="M-40 60 C 380 140, 620 260, 830 520 C 880 585, 915 640, 940 700" />
          <path className="spark" d="M940 668 L948 692 L972 700 L948 708 L940 732 L932 708 L908 700 L932 692 Z" />
        </svg>
      </div>

      <div className="wrap">
        <header>
          <a className="brand" href="/">
            <Mark className="brand-mark" />
            <span>
              Priori<em>Code</em>
            </span>
          </a>
          <nav>
            <a href={`${GITHUB}/blob/main/README.md`}>Docs</a>
            <a href={`${GITHUB}/releases`}>Releases</a>
            <a href={GITHUB}>GitHub</a>
            <a href="https://prioritech.co.id">Prioritech</a>
            <button
              className="toggle"
              onClick={flip}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <circle cx="8" cy="8" r="3.4" />
                  <path
                    d="M8 0.8v2M8 13.2v2M0.8 8h2M13.2 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M13.9 9.9A6.1 6.1 0 0 1 6.1 2.1a6.1 6.1 0 1 0 7.8 7.8Z" />
                </svg>
              )}
            </button>
          </nav>
        </header>

        <main>
          <section className="hero">
            <div className="hero-copy">
              <span className="badge">
                <span className="dot" />
                Open source · Built in Jakarta
              </span>
              <h1>
                Code at the speed
                <br />
                of a <span className="stroke">shooting star.</span>
              </h1>
              <p className="lede">
                PrioriCode is the open source AI coding agent by <a href="https://prioritech.co.id">Prioritech</a>. One
                command installs it into your terminal, and it reads your codebase, runs your tools, and ships your
                code.
              </p>
              <Install />
              <div className="cta">
                <a className="primary" href={`${GITHUB}/releases/latest`}>
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 1a.75.75 0 0 1 .75.75v6.44l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 1.06-1.06l1.97 1.97V1.75A.75.75 0 0 1 8 1ZM2 13.25A.75.75 0 0 1 2.75 12.5h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
                  </svg>
                  Download latest
                </a>
                <a href={GITHUB}>
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.53.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .75-.24 2.48.92a6.9 6.9 0 0 1 2.27-.3c.77 0 1.54.2 2.27.6 1.72-1.16 2.48-.92 2.48-.92.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                  Star on GitHub
                </a>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="glow" />
              <AsciiLogo />
            </div>
          </section>

          <section className="features">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <div className="icon">{f.icon}</div>
                <h2>{f.title}</h2>
                <p>{f.body}</p>
              </div>
            ))}
          </section>
        </main>

        <footer>
          <span>
            © {new Date().getFullYear()} PT Prioritech Indonesia Optima ·{" "}
            <a href="https://prioritech.co.id">prioritech.co.id</a>
          </span>
          <Version />
        </footer>
      </div>
    </>
  )
}
