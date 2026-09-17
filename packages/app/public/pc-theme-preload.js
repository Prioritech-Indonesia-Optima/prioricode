;(function () {
  var key = "prioricode-theme-id"
  var themeId = localStorage.getItem(key) || "prioricode"

  if (themeId === "oc-1" || themeId === "oc-2" || themeId === "pc-2") {
    themeId = "prioricode"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("prioricode-pc-css-light")
    localStorage.removeItem("prioricode-pc-css-dark")
  }

  var scheme = localStorage.getItem("prioricode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#100f0d" : "#f7f6ef"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#100f0d" : "#f7f6ef")

  if (themeId === "prioricode") return

  var css = localStorage.getItem("prioricode-pc-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "pc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
