// Branded HTML pages for local OAuth callback servers.
//
// These are served by the loopback HTTP servers that finish an OAuth exchange
// (MCP, Codex/ChatGPT, xAI, Snowflake, DigitalOcean, ...). The functions return
// a fully self-contained HTML string with no external assets, so they work
// offline and drop into any transport (`res.end(...)`, Effect `response.end`,
// etc.).
//
// The visual language mirrors the PrioriCode app: the design tokens are a curated
// subset of the OC-2 semantic tokens in `packages/ui/src/styles/theme.css`, and
// the wordmark is the same geometry as `packages/ui/src/components/logo.tsx`.
// Keep this file in sync with those sources when the brand changes.

export interface CallbackPageOptions {
  /** Friendly integration name shown as a subtitle, e.g. "xAI", "Snowflake", "MCP". */
  provider?: string
  /** Attempt to close the window shortly after success. Defaults to true. */
  autoClose?: boolean
}

export function success(options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization successful",
    body: renderCard({
      status: "success",
      headline: "Authorization successful",
      message: provider ? `PrioriCode is now connected to ${escapeHtml(provider)}.` : "PrioriCode is now authorized.",
      footnote: "You can close this window.",
    }),
    script: options?.autoClose === false ? undefined : AUTO_CLOSE_SCRIPT,
  })
}

export function error(detail: string, options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization failed",
    body: renderCard({
      status: "error",
      headline: "Authorization failed",
      message: provider
        ? `PrioriCode couldn't finish connecting to ${escapeHtml(provider)}.`
        : "PrioriCode couldn't complete authorization.",
      detail,
      footnote: "Close this window and try again from PrioriCode.",
    }),
  })
}

export interface BootstrapOptions {
  /** Same-origin path the in-browser script POSTs the parsed callback to. */
  tokenPath: string
  provider?: string
}

// For flows where the credential arrives in the URL fragment (implicit grant),
// the browser must relay it back to the loopback server. This renders a pending
// page whose script reads the fragment, POSTs it to `tokenPath`, then resolves
// to the success or error state in place.
export function bootstrap(options: BootstrapOptions) {
  return renderDocument({
    title: "Finishing sign-in",
    body: renderCard({
      status: "pending",
      headline: "Finishing sign-in",
      message: options.provider
        ? `Completing your ${escapeHtml(options.provider)} authorization.`
        : "Completing authorization.",
      footnote: "You can close this window once sign-in finishes.",
    }),
    script: bootstrapScript(options),
  })
}

export * as OauthCallbackPage from "./page"

type Status = "pending" | "success" | "error"

function renderCard(input: { status: Status; headline: string; message: string; detail?: string; footnote: string }) {
  const detail = input.detail?.trim()
  return `<main class="card" id="oc-card" data-status="${input.status}" role="status" aria-live="polite">
      <div class="brand">${WORDMARK}</div>
      <div class="status" aria-hidden="true">
        <span class="icon icon-pending">${ICON_SPINNER}</span>
        <span class="icon icon-success">${ICON_CHECK}</span>
        <span class="icon icon-error">${ICON_CROSS}</span>
      </div>
      <h1 class="headline" id="oc-headline">${escapeHtml(input.headline)}</h1>
      <p class="message" id="oc-message">${input.message}</p>
      <pre class="detail" id="oc-detail"${detail ? "" : " hidden"}>${detail ? escapeHtml(detail) : ""}</pre>
      <p class="footnote" id="oc-footnote">${escapeHtml(input.footnote)}</p>
    </main>`
}

function renderDocument(input: { title: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(input.title)} · PrioriCode</title>
    <style>${STYLES}</style>
  </head>
  <body>
    ${input.body}${input.script ? `\n    <script>${input.script}</script>` : ""}
  </body>
</html>`
}

const AUTO_CLOSE_SCRIPT = `setTimeout(function(){try{window.close()}catch(e){}},2500)`

function bootstrapScript(options: BootstrapOptions) {
  return `var PROVIDER=${scriptString(options.provider ?? "")};
var TOKEN_URL=new URL(${scriptString(options.tokenPath)},window.location.origin).href;
(function(){
  var card=document.getElementById("oc-card"),headline=document.getElementById("oc-headline"),message=document.getElementById("oc-message"),detail=document.getElementById("oc-detail"),footnote=document.getElementById("oc-footnote");
  function fail(text){card.dataset.status="error";headline.textContent="Authorization failed";message.textContent=PROVIDER?("PrioriCode couldn't finish connecting to "+PROVIDER+"."):"PrioriCode couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from PrioriCode."}
  function ok(){card.dataset.status="success";headline.textContent="Authorization successful";message.textContent=PROVIDER?("PrioriCode is now connected to "+PROVIDER+"."):"PrioriCode is now authorized.";detail.hidden=true;footnote.textContent="You can close this window.";setTimeout(function(){try{window.close()}catch(e){}},2500)}
  try{
    var hash=new URLSearchParams((window.location.hash||"").slice(1));
    var search=new URLSearchParams(window.location.search||"");
    var err=hash.get("error")||search.get("error");
    var errDescription=hash.get("error_description")||search.get("error_description");
    var body=err?{error:err,error_description:errDescription||""}:{access_token:hash.get("access_token")||"",expires_in:hash.get("expires_in")||"0",state:hash.get("state")||""};
    fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(res){
      if(!res.ok)return res.text().catch(function(){return""}).then(function(t){throw new Error(t||("callback failed ("+res.status+")"))});
      if(err){fail(errDescription||err);return}
      ok();
    }).catch(function(e){fail(String(e&&e.message?e.message:e))});
  }catch(e){fail(String(e&&e.message?e.message:e))}
})()`
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// Curated subset of OC-2 tokens (packages/ui/src/styles/theme.css). Default is
// light; dark applies via prefers-color-scheme. The [data-theme] selectors let a
// host force a scheme without changing the default.
const LIGHT_VARS = `
    --oc-bg: #f8f8f8;
    --oc-card: #fcfcfc;
    --oc-text-strong: #171717;
    --oc-text-base: #6f6f6f;
    --oc-text-weak: #8f8f8f;
    --oc-border-weak: #e5e5e5;
    --oc-icon-strong: #171717;
    --oc-icon-base: #8f8f8f;
    --oc-icon-weak: #dbdbdb;
    --oc-success: #2dba26;
    --oc-error: #ed4831;
    --oc-detail-bg: #fff8f6;
    --oc-detail-border: #fdc3b7;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.10), 0 6px 12px -2px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.06);`

const DARK_VARS = `
    --oc-bg: #101010;
    --oc-card: #161616;
    --oc-text-strong: rgba(255,255,255,.936);
    --oc-text-base: rgba(255,255,255,.618);
    --oc-text-weak: rgba(255,255,255,.422);
    --oc-border-weak: #282828;
    --oc-icon-strong: #ededed;
    --oc-icon-base: #7e7e7e;
    --oc-icon-weak: #343434;
    --oc-success: #12c905;
    --oc-error: #fc533a;
    --oc-detail-bg: #28110c;
    --oc-detail-border: #6a1206;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.55), 0 6px 12px -2px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.4);`

const STYLES = `
  :root { color-scheme: light dark;${LIGHT_VARS}
    --oc-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --oc-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK_VARS} } }
  :root[data-theme="dark"] {${DARK_VARS} }
  :root[data-theme="light"] {${LIGHT_VARS} }

  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--oc-bg);
    color: var(--oc-text-base);
    font-family: var(--oc-font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .card {
    width: min(100%, 28rem);
    padding: 2.25rem 2rem 1.75rem;
    background: var(--oc-card);
    border: 1px solid var(--oc-border-weak);
    border-radius: 14px;
    box-shadow: var(--oc-shadow);
    text-align: center;
  }
  .brand { display: flex; justify-content: center; margin-bottom: 1.75rem; }
  .brand svg { height: 19px; width: auto; }
  .status { display: flex; justify-content: center; margin-bottom: 1.125rem; }
  .icon { display: none; line-height: 0; }
  .icon svg { display: block; }
  .card[data-status="pending"] .icon-pending,
  .card[data-status="success"] .icon-success,
  .card[data-status="error"] .icon-error { display: block; }
  .icon-success { color: var(--oc-success); }
  .icon-error { color: var(--oc-error); }
  .icon-pending { color: var(--oc-text-weak); }
  .headline { margin: 0; font-size: 1.1875rem; font-weight: 500; line-height: 1.3; letter-spacing: -0.012em; color: var(--oc-text-strong); }
  .message { margin: 0.5rem 0 0; font-size: 0.9375rem; color: var(--oc-text-base); }
  .detail {
    margin: 1.25rem 0 0;
    padding: 0.75rem 0.875rem;
    text-align: left;
    font-family: var(--oc-font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--oc-text-strong);
    background: var(--oc-detail-bg);
    border: 1px solid var(--oc-detail-border);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 9.5rem;
    overflow: auto;
  }
  .detail[hidden] { display: none; }
  .footnote { margin: 1.5rem 0 0; font-size: 0.8125rem; color: var(--oc-text-weak); }
  .spinner { animation: oc-spin 0.8s linear infinite; transform-origin: center; }
  @keyframes oc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`

// prioricode wordmark — same path geometry as packages/ui/src/components/logo.tsx (Logo).
const WORDMARK = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3600 1087" fill="none" aria-label="prioricode" role="img">
        <path d="M0 0 C147.01 -0.15 294.02 0.09 527.45 0.89 C548.35 0.97 569.26 1.04 590.16 1.11 C653.01 1.33 715.85 1.55 778.7 1.83 C783.48 1.85 788.26 1.87 793.05 1.89 C794.2 1.89 795.36 1.9 796.55 1.9 C814.24 1.98 831.93 2.04 849.62 2.09 C863 2.13 876.39 2.19 889.77 2.25 C896.86 2.29 903.95 2.32 911.04 2.33 C917.24 2.34 923.43 2.37 929.63 2.41 C931.79 2.42 933.94 2.42 936.09 2.42 C984.4 2.38 1032.81 26.9 1067.42 59.57 C1069.66 61.68 1071.98 63.69 1074.31 65.69 C1078.27 69.24 1081.58 72.91 1085 77 C1085.94 78.09 1086.87 79.17 1087.84 80.29 C1128.41 128.48 1143.15 187.45 1139.69 249.55 C1139.27 253.74 1138.71 257.85 1138 262 C1137.77 263.43 1137.53 264.87 1137.29 266.34 C1130.16 304.67 1112.48 341.55 1087 371 C1086.33 371.78 1085.66 372.56 1084.97 373.37 C1073.17 386.79 1060.53 398.58 1046 409 C1045.42 409.42 1045.42 409.42 1042.47 411.57 C1025.51 423.43 1006.64 432.59 987 439 C985.38 439.54 983.76 440.09 982.1 440.64 C960.24 447.79 939.41 450.28 916.44 450.45 C914.32 450.47 912.19 450.49 910.07 450.52 C903.17 450.59 896.26 450.64 889.36 450.69 C888.18 450.7 887 450.7 885.78 450.71 C874.65 450.78 863.51 450.85 852.38 450.89 C838.18 450.94 823.99 451.05 809.8 451.21 C799.79 451.32 789.78 451.38 779.76 451.4 C773.8 451.41 767.83 451.45 761.86 451.54 C756.25 451.63 750.65 451.65 745.04 451.62 C742.01 451.62 738.99 451.69 735.96 451.76 C722.9 451.61 722.9 451.61 717.47 447.01 C714.66 443.46 712.34 439.86 710 436 C708.16 433.74 706.29 431.51 704.38 429.31 C701.1 425.48 697.89 421.63 694.75 417.69 C689.81 411.61 684.43 405.96 679.04 400.29 C675.97 397.03 672.95 393.74 669.94 390.42 C663.27 383.13 656.31 376.16 649.31 369.19 C648.05 367.92 646.78 366.65 645.47 365.34 C639.48 359.35 633.45 353.51 627 348 C624.55 345.72 622.12 343.43 619.69 341.12 C614.45 336.22 609.14 331.54 603.53 327.07 C601 325 598.59 322.84 596.19 320.62 C591.01 315.89 585.48 311.64 579.91 307.38 C577 305 577 305 575 302 C576.79 302 578.58 302 580.43 301.99 C622.99 301.94 665.54 301.86 708.1 301.77 C713.34 301.76 718.58 301.75 723.82 301.74 C724.87 301.74 725.91 301.73 726.98 301.73 C743.87 301.7 760.75 301.67 777.63 301.65 C794.96 301.63 812.29 301.59 829.62 301.55 C839.35 301.53 849.08 301.51 858.81 301.5 C867.97 301.5 877.13 301.48 886.29 301.45 C889.65 301.44 893.01 301.43 896.37 301.43 C900.96 301.44 905.56 301.42 910.15 301.4 C910.81 301.4 910.81 301.4 914.16 301.41 C935.21 301.25 951.69 293.28 967.12 279.25 C982.57 262.31 987.72 242.77 987.25 220.3 C986.32 200.65 978.85 183.08 965 169 C949.82 156.12 932.55 148.77 912.55 148.96 C910.59 148.97 908.64 148.99 906.62 149 C904.45 149.03 902.27 149.05 900.1 149.07 C897.79 149.09 895.48 149.11 893.17 149.13 C888.15 149.17 883.12 149.21 878.1 149.26 C864.12 149.39 850.14 149.5 836.16 149.61 C835.42 149.61 835.42 149.61 831.66 149.64 C808.2 149.83 784.75 149.96 761.29 150.06 C760.5 150.06 760.5 150.06 756.48 150.08 C740.03 150.15 723.58 150.21 707.13 150.27 C698.67 150.3 690.21 150.33 681.75 150.36 C680.07 150.37 678.39 150.38 676.65 150.38 C649.53 150.49 622.41 150.72 595.29 150.99 C567.36 151.26 539.43 151.4 511.5 151.43 C495.86 151.44 480.21 151.52 464.57 151.75 C342.42 153.48 342.42 153.48 293.74 120.37 C282.8 112.92 271.1 107.57 258.99 102.31 C254.61 100.39 250.27 98.39 245.92 96.39 C203.99 77.41 161.58 59.7 118.56 43.35 C114.58 41.84 110.62 40.32 106.65 38.8 C74.91 26.68 42.98 15.11 10.66 4.59 C9.26 4.13 7.85 3.67 6.4 3.2 C5.16 2.79 3.92 2.39 2.64 1.98 C2.2 1.82 2.2 1.82 0 1 C0 0.67 0 0.34 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(284,138)" />
        <path d="M0 0 C169 0 169 0 185 12 C186.94 13.44 188.88 14.89 190.88 16.38 C202.51 25.11 214.01 34.01 225.05 43.48 C227.87 45.89 230.74 48.23 233.62 50.56 C238.3 54.37 242.77 58.36 247.2 62.45 C249.4 64.45 251.63 66.42 253.88 68.38 C264.3 77.52 274.25 87.16 284.06 96.94 C284.85 97.72 285.63 98.5 286.44 99.3 C291.17 104.04 295.64 108.92 300 114 C301.01 115.14 302.03 116.29 303.07 117.46 C326 143.53 326 143.53 326 148 C267.92 148 209.84 148 150 148 C150 217.3 150 286.6 150 358 C100.5 358 51 358 0 358 C0 239.86 0 121.72 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(454,441)" />
        <path d="M0 0 C79.86 0 159.72 0 242 0 C242 48.18 242 96.36 242 146 C196.43 146.68 196.43 146.68 173.97 146.85 C161.81 146.95 149.65 147.07 137.49 147.28 C127.86 147.45 118.24 147.56 108.61 147.6 C103.51 147.62 98.41 147.67 93.31 147.8 C87.62 147.92 81.94 147.94 76.25 147.93 C74.56 147.99 72.86 148.05 71.11 148.12 C66.48 148.05 63.2 147.97 59 146 C56.18 140.49 55.65 135.1 55 129 C54.41 126.68 53.77 124.37 53.06 122.09 C52.73 120.99 52.4 119.9 52.06 118.77 C51.71 117.65 51.36 116.53 51 115.38 C50.62 114.15 50.24 112.93 49.85 111.68 C41.2 84.53 30.03 58.32 17 33 C16.53 32.08 16.05 31.15 15.56 30.2 C13.99 27.13 12.4 24.07 10.81 21 C10.31 20.03 9.81 19.06 9.3 18.07 C7.05 13.75 4.72 9.56 2.14 5.44 C0 2 0 2 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(1030,649)" />
        <path d="M0 0 C22.21 -0.47 44.43 -0.95 67.31 -1.44 C74.31 -1.65 81.31 -1.86 88.52 -2.07 C97.11 -2.18 97.11 -2.18 101.13 -2.2 C103.93 -2.23 106.73 -2.31 109.52 -2.43 C128.73 -3.19 128.73 -3.19 136 0 C141.68 5.46 144.04 12.72 146.16 20.15 C147.38 24.28 149.1 28.16 150.82 32.1 C151.93 34.94 153.04 37.78 154.12 40.62 C154.71 42.16 155.3 43.69 155.91 45.27 C183 116.6 183 116.6 183 146 C122.61 146 62.22 146 0 146 C0 97.82 0 49.64 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(689,649)" />
        <path d="M0 0 C12.36 6.74 12.36 6.74 17.39 9.63 C18.5 10.26 19.61 10.9 20.75 11.55 C21.91 12.22 23.06 12.88 24.25 13.56 C52.69 29.85 81.27 45.87 110.12 61.44 C118.43 65.93 126.72 70.46 135 75 C135.89 75.49 136.78 75.97 137.7 76.48 C140.26 77.88 142.82 79.28 145.38 80.69 C146.85 81.5 148.32 82.3 149.84 83.14 C150.88 83.75 151.92 84.37 153 85 C153 85.33 153 85.66 153 86 C102.51 86 52.02 86 0 86 C0 57.62 0 29.24 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(214,200)" />
        <path d="M0 0 C31.02 0 62.04 0 94 0 C94 0.33 94 0.66 94 1 C65.29 1 36.58 1 7 1 C7 1.66 7 2.32 7 3 C4.66 2.37 2.32 1.7 0 1 C0 0.67 0 0.34 0 0 Z " fill="var(--oc-icon-strong)" transform="translate(284,138)" />
        <path d="M0 0 C0.33 0.17 0.33 0.17 2 1 C1.62 1.97 1.25 2.94 0.86 3.94 C-10.29 33.16 -21.72 67.03 -8.56 97.31 C0.71 116.24 17.7 128.47 37.18 135.51 C41.73 136.98 46.3 138.38 50.88 139.75 C54.29 140.8 57.7 141.86 61.11 142.92 C62.79 143.44 64.48 143.96 66.21 144.5 C87.62 151.21 108.67 159.01 129.75 166.69 C130.86 167.09 131.96 167.49 133.1 167.91 C145.69 172.49 158.21 177.21 170.63 182.23 C174.35 183.74 178.07 185.21 181.81 186.66 C222.44 202.42 262.41 219.79 302 238 C303.23 238.56 304.45 239.13 305.71 239.71 C321.63 247.02 337.43 254.59 353.19 262.25 C354.87 263.07 356.55 263.88 358.28 264.72 C368.2 269.57 378.01 274.58 387.76 279.75 C391.19 281.57 394.63 283.37 398.08 285.14 C409.53 291.05 420.81 297.21 432 303.6 C436.14 305.95 440.29 308.27 444.46 310.56 C459.76 318.95 474.75 327.76 489.6 336.91 C492.85 338.91 496.12 340.89 499.38 342.86 C516.03 352.95 532.22 363.68 548.37 374.56 C551.73 376.82 555.1 379.06 558.47 381.3 C576.78 393.5 594.63 406.49 612 420 C614.1 421.6 616.21 423.21 618.31 424.81 C626 430.72 633.5 436.86 641 443 C641.99 443.81 642.98 444.61 644 445.44 C653.78 453.39 663.42 461.49 672.75 469.96 C674.77 471.79 676.82 473.58 678.88 475.38 C698.76 492.85 718.64 510.99 736 531 C737.15 532.15 738.31 533.31 739.5 534.5 C743.2 538.2 746.59 542.03 750 546 C750.9 547.04 751.8 548.09 752.72 549.16 C755.82 552.77 758.91 556.38 762 560 C762.47 560.55 762.47 560.55 764.87 563.34 C771.17 570.71 777.16 578.26 783 586 C783.9 587.18 784.8 588.35 785.73 589.57 C808.21 619.15 828.79 650.52 845 684 C845.97 685.95 846.95 687.89 847.93 689.84 C865.5 725.2 878.58 762.36 887.25 800.88 C887.48 801.91 887.72 802.94 887.96 804 C896.62 843.62 897.62 884.19 897.61 924.56 C897.61 930.27 897.64 935.98 897.66 941.69 C897.7 952.42 897.72 963.15 897.73 973.88 C897.75 988.44 897.8 1002.99 897.85 1017.55 C897.93 1040.37 897.96 1063.18 898 1086 C849.49 1086 800.98 1086 751 1086 C750.88 1074.93 750.76 1063.87 750.63 1052.47 C750.55 1045.35 750.47 1038.23 750.39 1031.11 C750.26 1019.88 750.13 1008.64 750.01 997.41 C748.68 874.17 748.68 874.17 739.58 813.89 C739.02 810.11 738.49 806.32 737.97 802.54 C737.22 797.28 736.21 792.17 735 787 C734.43 784.29 733.86 781.58 733.3 778.87 C729.55 761 725.59 743.4 720 726 C719.6 724.75 719.21 723.5 718.8 722.21 C702.9 672.08 680.4 623.67 648 582 C647.16 580.88 646.32 579.77 645.45 578.62 C632.52 561.51 617.99 545.81 602.81 530.69 C601.78 529.66 600.76 528.62 599.7 527.56 C594.29 522.16 588.81 516.97 583 512 C581.22 510.38 579.45 508.76 577.69 507.12 C573.2 503.03 568.59 499.15 563.86 495.33 C560.82 492.85 557.85 490.31 554.88 487.75 C548.51 482.34 541.9 477.29 535.25 472.25 C531.34 469.26 527.51 466.21 523.69 463.12 C517.11 457.83 510.39 452.75 503.62 447.71 C497.96 443.49 492.37 439.18 486.81 434.81 C478.4 428.25 469.76 422.09 461 416 C460.28 415.49 460.28 415.49 456.65 412.91 C427.46 392.26 397.46 372.71 367 354 C365.9 353.32 364.8 352.64 363.67 351.93 C346.61 341.36 329.33 331.13 312 321 C310.09 319.88 308.17 318.75 306.26 317.63 C295.77 311.48 285.24 305.41 274.59 299.54 C270.34 297.19 266.11 294.79 261.88 292.39 C251.53 286.5 241.09 280.79 230.58 275.18 C223.57 271.42 216.64 267.54 209.75 263.56 C202.93 259.63 196.07 255.95 189 252.51 C184.52 250.25 180.29 247.59 176 245 C174.14 244.06 172.28 243.14 170.4 242.23 C164.33 239.22 158.51 235.89 152.69 232.44 C144.51 227.62 136.29 222.89 128 218.25 C120.2 213.87 112.56 209.32 105.01 204.52 C100.44 201.65 95.82 198.89 91.19 196.12 C81.35 190.25 71.67 184.15 62 178 C58.85 176.02 55.71 174.04 52.56 172.06 C47.61 168.95 42.69 165.81 37.82 162.57 C13.2 146.21 -13.18 136.7 -43.12 141.69 C-46.24 142.59 -49.06 143.64 -52 145 C-52.94 145.44 -53.89 145.87 -54.86 146.32 C-74.6 156.31 -89.59 174.43 -103.52 191.12 C-105.57 193.51 -107.77 195.77 -110 198 C-109 192.75 -107.63 187.86 -105.75 182.88 C-96.76 158.34 -89.63 130.22 -99.59 104.96 C-108.39 86.11 -123.91 71.75 -140 59 C-142.58 56.88 -145.17 54.75 -147.75 52.62 C-155.31 46.48 -163.08 40.68 -171 35 C-170.67 34.84 -170.67 34.84 -169 34 C-166.41 35.01 -163.85 36.11 -161.31 37.25 C-128.88 51.17 -93.02 66.01 -57.94 54.31 C-46.69 49.05 -37.86 41.6 -29 33 C-27.98 32.02 -26.95 31.03 -25.89 30.02 C-18.53 22.81 -12 15.21 -5.74 7.05 C-3.88 4.66 -1.95 2.32 0 0 Z " fill="#F9B110" transform="translate(172,1)" />
        <text x="1560" y="770" font-family="inherit" font-size="560" font-weight="700" letter-spacing="-10" fill="var(--oc-icon-strong)">prioricode</text>
      </svg>`

const ICON_CHECK = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.4" /></svg>`

const ICON_CROSS = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>`

const ICON_SPINNER = `<svg class="spinner" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.2" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>`
