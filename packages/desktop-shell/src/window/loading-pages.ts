import {
  STARTUP_SPLASH_STYLES,
  startupSplashMarkup,
} from "./startup-splash-document.js";
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
  return dark ? "#272521" : "#faf8f1";
}

export type LoadingStage = "starting" | "preparing" | "opening";

const LOADING_STAGES: Record<LoadingStage, string> = {
  starting: "Starting local services",
  preparing: "Preparing your workspace",
  opening: "Opening Nerve",
};

export interface LoadingPageOptions {
  status?: string;
  /** Mid-session pages (reconnect) skip the intro instead of replaying it. */
  playIntro?: boolean;
}

export function loadingHtml(options: LoadingPageOptions = {}): string {
  const { status = LOADING_STAGES.starting, playIntro = true } = options;
  return `<!doctype html>
<html lang="en"${playIntro ? "" : ` data-splash-intro="settled"`}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:" />
    <title>Nerve</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
${startupSplashMarkup(status)}
  </body>
</html>`;
}

export function loadingStatusScript(statusText: string): string {
  const serialized = JSON.stringify(statusText);
  return `(() => {
    const status = document.getElementById("startup-splash-status");
    if (!status) return false;
    status.textContent = ${serialized};
    return true;
  })()`;
}

export function loadingStageScript(stage: LoadingStage): string {
  const statusText = JSON.stringify(LOADING_STAGES[stage]);
  const completion =
    stage === "opening"
      ? `\n    document.getElementById("startup-splash")?.classList.add("is-complete");`
      : "";

  return `(() => {
    const status = document.getElementById("startup-splash-status");
    if (!status) return false;
    status.textContent = ${statusText};${completion}
    return true;
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
      --background: oklch(0.979 0.012 92);
      --foreground: oklch(0.3438 0.0269 95.7);
      --primary: oklch(0.57 0.1375 39);
      --muted-foreground: oklch(0.5341 0.0078 97.5);
      --border: oklch(0.872 0.017 95);
      --destructive: oklch(0.5 0.19 27);
      --radius: 0.375rem;
      --radius-lg: 0.375rem;
      --font-sans: "Outfit", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --text-xs: 0.8125rem;
      --text-sm: 0.9375rem;
      --text-xl: 1.25rem;
      --splash-bg: var(--background);
      --splash-fg: var(--foreground);
      --splash-primary: var(--primary);
      --splash-muted: var(--muted-foreground);
      --splash-border: var(--border);
      --splash-font-sans: var(--font-sans);
      font-family: var(--font-sans);
      text-rendering: optimizeLegibility;
      font-kerning: normal;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: oklch(0.264 0.018 80);
        --foreground: oklch(0.9 0.012 95);
        --primary: oklch(0.6724 0.1308 38.8);
        --muted-foreground: oklch(0.7713 0.017 99);
        --border: oklch(0.353 0.022 82);
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
    ${STARTUP_SPLASH_STYLES}
  `;
}
