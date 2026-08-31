import { escapeHtml } from "./html.js";

export class ShellPageUrlRegistry {
  #activeUrl: string | undefined;

  create(html: string): string {
    const url = createDataUrl(html);
    this.#activeUrl = url;
    return url;
  }

  isTrusted(rawUrl: string): boolean {
    return rawUrl === this.#activeUrl;
  }

  clear(): void {
    this.#activeUrl = undefined;
  }
}

export function createDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// Native BrowserWindow fallback used before either loading document can paint.
// These mirror the light/dark --background tokens in shellStyles().
export function loadingWindowBackground(dark: boolean): string {
  return dark ? "#262624" : "#faf9f5";
}

export type LoadingStage = "starting" | "preparing" | "opening";

const LOADING_STAGES: Record<LoadingStage, string> = {
  starting: "Starting local services",
  preparing: "Preparing your workspace",
  opening: "Opening Nerve",
};

export function loadingHtml(statusText = LOADING_STAGES.starting): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:" />
    <title>Nerve</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
    <main class="loading" aria-busy="true" aria-label="Starting Nerve">
      <div class="loading-mark-badge" aria-hidden="true">
        <svg
          class="loading-mark"
          viewBox="120 120 272 272"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          focusable="false"
        >
          <g
            stroke="currentColor"
            stroke-width="32"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M150 350V162" />
            <path d="M362 350V162" />
            <path d="M150 162L232 235L258 208L284 288L362 350" />
          </g>
        </svg>
      </div>
      <div class="loading-progress">
        <p id="loading-status" class="status" role="status" aria-live="polite">${escapeHtml(statusText)}</p>
        <div
          id="loading-progressbar"
          class="loading-progressbar"
          role="progressbar"
          aria-label="Starting Nerve"
        >
          <span id="loading-progress-fill" class="loading-progress-fill"></span>
        </div>
      </div>
    </main>
    <script>${loadingProgressScript()}</script>
  </body>
</html>`;
}

export function loadingStatusScript(statusText: string): string {
  const serialized = JSON.stringify(statusText);
  return `(() => {
    const status = document.getElementById("loading-status");
    if (!status) return false;
    status.textContent = ${serialized};
    return true;
  })()`;
}

export function loadingStageScript(stage: LoadingStage): string {
  const statusText = JSON.stringify(LOADING_STAGES[stage]);
  const shouldComplete = stage === "opening";

  return `(() => {
    const status = document.getElementById("loading-status");
    if (!status) return false;
    status.textContent = ${statusText};
    if (${shouldComplete}) window.nerveLoadingProgress?.complete();
    return true;
  })()`;
}

function loadingProgressScript(): string {
  return `(() => {
    const fill = document.getElementById("loading-progress-fill");
    if (!fill) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now();
    let frame;

    window.nerveLoadingProgress = {
      complete() {
        if (frame) cancelAnimationFrame(frame);
        fill.style.transition = reducedMotion ? "none" : "width 160ms ease-out";
        fill.style.width = "100%";
      },
    };

    if (reducedMotion) {
      fill.style.width = "8%";
      return;
    }

    const advance = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(94, 94 * (1 - Math.exp(-elapsed / 450)));
      fill.style.width = progress + "%";
      frame = requestAnimationFrame(advance);
    };

    frame = requestAnimationFrame(advance);
  })()`;
}

export function errorHtml(error: unknown, dataDir = "~/.nerve"): string {
  const message = error instanceof Error ? error.message : String(error);
  const escapedDataDir = escapeHtml(dataDir);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
    <title>Nerve startup error</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
    <main class="error">
      <h1 class="error-title">Daemon unavailable</h1>
      <p class="status">Could not start or load the local daemon. Use the Nerve tray menu → “Restart Daemon” to try again. Logs are in ${escapedDataDir}/logs and crash reports are in ${escapedDataDir}/crashes. In corporate proxy environments, ensure Electron was rebuilt through the proxy and NO_PROXY includes localhost,127.0.0.1,::1.</p>
      <pre>${escapeHtml(message)}</pre>
    </main>
  </body>
</html>`;
}

function shellStyles(): string {
  // Mirrors the shadcn theme tokens from packages/ui-kit/src/styles/theme.css
  // so the pre-daemon shell matches the workbench in both light and dark.
  return `
    :root {
      color-scheme: light dark;
      --background: oklch(0.9818 0.0054 95.0986);
      --foreground: oklch(0.3438 0.0269 95.7226);
      --primary: oklch(0.57 0.1375 39.0427);
      --muted-foreground: oklch(0.5341 0.0078 97.4503);
      --border: oklch(0.8847 0.0069 97.3627);
      --destructive: oklch(0.5 0.19 27);
      --radius: 0.625rem;
      --radius-lg: 0.625rem;
      --font-sans: "Outfit", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --text-xs: 0.8125rem;
      --text-sm: 0.9375rem;
      --text-xl: 1.25rem;
      font-family: var(--font-sans);
      text-rendering: optimizeLegibility;
      font-kerning: normal;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: oklch(0.2679 0.0036 106.6427);
        --foreground: oklch(0.9576 0.0027 106.4494);
        --primary: oklch(0.6724 0.1308 38.7559);
        --muted-foreground: oklch(0.7713 0.0169 99.0657);
        --border: oklch(0.3618 0.0101 106.8928);
        --destructive: oklch(0.8 0.114 25.5);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--background);
      color: var(--foreground);
      user-select: none;
      -webkit-app-region: drag;
    }
    main {
      width: min(32rem, calc(100vw - 3rem));
      display: grid;
      justify-items: center;
      padding: 1.5rem;
      text-align: center;
    }
    .loading {
      gap: 0;
    }
    .loading-mark-badge {
      display: grid;
      width: 3rem;
      height: 3rem;
      place-items: center;
      border-radius: var(--radius-lg);
      background: var(--foreground);
      color: var(--background);
      animation: loading-breathe 2.4s ease-in-out infinite;
    }
    .loading-mark {
      /* 62.5% of the badge, matching the titlebar brand mark proportions.
         No optical nudge: the mark's ink is already centered in its viewBox. */
      width: 1.875rem;
      height: 1.875rem;
    }
    @keyframes loading-breathe {
      0%,
      100% { opacity: 1; }
      50% { opacity: 0.72; }
    }
    .error-title {
      margin: 0;
      color: var(--foreground);
      font-size: var(--text-xl);
      font-weight: 600;
      line-height: 1.75rem;
      letter-spacing: -0.025em;
    }
    .status {
      margin: 0;
      color: var(--muted-foreground);
      font-size: var(--text-sm);
      line-height: 1.625;
    }
    .loading-progress {
      width: min(24rem, 100%);
      margin-top: 1.5rem;
    }
    .loading .status {
      margin-bottom: 0.5rem;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .loading-progressbar {
      width: min(16rem, 100%);
      margin-inline: auto;
      height: 0.25rem;
      overflow: hidden;
      border-radius: 999px;
      background: var(--border);
    }
    .loading-progress-fill {
      display: block;
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--primary);
    }
    .error {
      gap: 1rem;
    }
    pre {
      width: 100%;
      max-height: 17.5rem;
      margin: 0.25rem 0 0;
      overflow: auto;
      user-select: text;
      -webkit-app-region: no-drag;
      white-space: pre-wrap;
      text-align: left;
      border: 1px solid color-mix(in oklab, var(--destructive) 40%, transparent);
      border-radius: var(--radius);
      padding: 0.75rem;
      background: color-mix(in oklab, var(--destructive) 10%, transparent);
      color: var(--destructive);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      line-height: 1.5;
    }
    @media (prefers-reduced-motion: reduce) {
      .loading-progress-fill { transition: none; }
      .loading-mark-badge { animation: none; }
    }
  `;
}
