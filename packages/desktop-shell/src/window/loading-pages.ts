import { escapeHtml } from "@nervekit/contracts";

export function createDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function loadingHtml(statusText = "Starting local daemon…"): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nerve</title>
    <style>${shellStyles()}</style>
  </head>
  <body>
    <main
      class="loading"
      aria-busy="true"
      aria-labelledby="loading-title"
    >
      <div class="signal" aria-hidden="true">
        <div class="signal-ring"></div>
        <div class="signal-ring signal-ring-inner"></div>
        <div class="signal-glow"></div>
        <div class="signal-orbit">
          <span class="signal-dot"></span>
        </div>
        <div class="signal-card">
          <svg
            class="signal-mark"
            viewBox="120 120 272 272"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
          >
            <g
              stroke="currentColor"
              stroke-width="28"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M150 350V162" />
              <path d="M362 350V162" />
              <path d="M150 162L222 226L246 194L272 300L296 262L362 350" />
            </g>
          </svg>
        </div>
      </div>
      <p class="eyebrow">Nerve</p>
      <h1 id="loading-title" class="loading-title">Getting things ready</h1>
      <p class="status" role="status" aria-live="polite">${escapeHtml(statusText)}</p>
    </main>
  </body>
</html>`;
}

export function errorHtml(error: unknown, dataDir = "~/.nerve"): string {
  const message = error instanceof Error ? error.message : String(error);
  const escapedDataDir = escapeHtml(dataDir);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      --card: oklch(0.9665 0.0067 97.3521);
      --primary: oklch(0.6171 0.1375 39.0427);
      --muted-foreground: oklch(0.5341 0.0078 97.4503);
      --border: oklch(0.8847 0.0069 97.3627);
      --destructive: oklch(0.1908 0.002 106.5859);
      --radius: 0.625rem;
      --shadow-sm: 0 1px 3px 0 hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1);
      --font-sans: "Outfit", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --text-xs: 0.75rem;
      --text-sm: 0.875rem;
      --text-xl: 1.25rem;
      font-family: var(--font-sans);
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-kerning: normal;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: oklch(0.2679 0.0036 106.6427);
        --foreground: oklch(0.9576 0.0027 106.4494);
        --card: oklch(0.2928 0.0018 106.5092);
        --primary: oklch(0.6724 0.1308 38.7559);
        --muted-foreground: oklch(0.7713 0.0169 99.0657);
        --border: oklch(0.3618 0.0101 106.8928);
        --destructive: oklch(0.6368 0.2078 25.3313);
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
    .signal {
      position: relative;
      display: grid;
      width: 7rem;
      height: 7rem;
      margin-bottom: 1.5rem;
      place-items: center;
    }
    .signal-ring,
    .signal-glow,
    .signal-orbit {
      position: absolute;
      border-radius: 999px;
    }
    .signal-ring {
      inset: 0;
      border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    }
    .signal-ring-inner {
      inset: 0.75rem;
      border-color: color-mix(in oklab, var(--primary) 30%, transparent);
      border-style: dashed;
    }
    .signal-glow {
      inset: 1.5rem;
      background: color-mix(in oklab, var(--primary) 10%, transparent);
      filter: blur(1rem);
    }
    .signal-orbit {
      inset: 0.25rem;
      animation: spin 12s linear infinite;
    }
    .signal-dot {
      position: absolute;
      top: 0;
      left: 50%;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: var(--primary);
      box-shadow: var(--shadow-sm);
      transform: translate(-50%, -50%);
    }
    .signal-card {
      position: relative;
      display: grid;
      width: 3.5rem;
      height: 3.5rem;
      place-items: center;
      border: 1px solid color-mix(in oklab, var(--primary) 30%, transparent);
      border-radius: calc(var(--radius) * 1.4);
      background: var(--card);
      box-shadow: var(--shadow-sm);
      color: var(--primary);
    }
    .signal-mark {
      width: 1.75rem;
      height: 1.75rem;
    }
    .eyebrow {
      margin: 0;
      color: var(--primary);
      font-size: var(--text-xs);
      font-weight: 500;
      line-height: 1rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .loading-title,
    .error-title {
      margin: 0;
      color: var(--foreground);
      font-size: var(--text-xl);
      font-weight: 600;
      line-height: 1.75rem;
      letter-spacing: -0.025em;
    }
    .loading-title {
      margin-top: 0.5rem;
    }
    .status {
      margin: 0;
      color: var(--muted-foreground);
      font-size: var(--text-sm);
      line-height: 1.625;
    }
    .loading .status {
      max-width: 28rem;
      margin-top: 0.5rem;
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
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .signal-orbit { animation: none; }
    }
  `;
}
