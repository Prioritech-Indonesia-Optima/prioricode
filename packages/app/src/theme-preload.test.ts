import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/pc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  for (const legacy of ["oc-1", "oc-2"]) {
    test(`migrates legacy ${legacy} to pc-2 before mount`, () => {
      localStorage.setItem("prioricode-theme-id", legacy)
      localStorage.setItem("prioricode-theme-css-light", "--background-base:#fff;")
      localStorage.setItem("prioricode-theme-css-dark", "--background-base:#000;")

      run()

      expect(document.documentElement.dataset.theme).toBe("pc-2")
      expect(document.documentElement.dataset.colorScheme).toBe("light")
      expect(localStorage.getItem("prioricode-theme-id")).toBe("pc-2")
      expect(localStorage.getItem("prioricode-theme-css-light")).toBeNull()
      expect(localStorage.getItem("prioricode-theme-css-dark")).toBeNull()
      expect(document.getElementById("pc-theme-preload")).toBeNull()
    })
  }

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("prioricode-theme-id", "nightowl")
    localStorage.setItem("prioricode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("pc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
