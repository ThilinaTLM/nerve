import { escapeHtml } from "@nervekit/shared";

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
    <main class="loading" aria-live="polite" aria-label="Starting Nerve">
      <div class="spinner" aria-hidden="true"></div>
      <p class="status">${escapeHtml(statusText)}</p>
    </main>
  </body>
</html>`;
}

export function errorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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
      <p class="status">Could not start the local daemon. Use the Nerve tray menu → “Restart Daemon” to try again.</p>
      <pre>${escapeHtml(message)}</pre>
    </main>
  </body>
</html>`;
}

function shellStyles(): string {
  // Mirrors the shadcn theme tokens from packages/web/src/app.css
  // so the splash matches the workbench in both light and dark.
  return `
    :root {
      color-scheme: light dark;
      --background: oklch(1 0 0);
      --foreground: oklch(0.147 0.004 49.3);
      --muted-foreground: oklch(0.547 0.021 43.1);
      --border: oklch(0.922 0.005 34.3);
      --destructive: oklch(0.577 0.245 27.325);
      --font-sans: Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --text-xs: 0.75rem;
      --text-sm: 0.875rem;
      --text-xl: 1.25rem;
      font-family: var(--font-sans);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: oklch(0.147 0.004 49.3);
        --foreground: oklch(0.986 0.002 67.8);
        --muted-foreground: oklch(0.714 0.014 41.2);
        --border: oklch(1 0 0 / 10%);
        --destructive: oklch(0.704 0.191 22.216);
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
      width: min(420px, calc(100vw - 48px));
      display: grid;
      justify-items: center;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .loading {
      gap: 14px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 2px solid var(--border);
      border-top-color: var(--foreground);
      border-radius: 999px;
      animation: spin 0.9s linear infinite;
    }
    .error-title {
      margin: 0;
      color: var(--foreground);
      font-size: var(--text-xl);
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .status {
      margin: 0;
      color: var(--muted-foreground);
      font-size: var(--text-sm);
      line-height: 1.5;
    }
    pre {
      width: 100%;
      max-height: 280px;
      margin: 4px 0 0;
      overflow: auto;
      user-select: text;
      -webkit-app-region: no-drag;
      white-space: pre-wrap;
      text-align: left;
      border: 1px solid color-mix(in oklab, var(--destructive) 40%, transparent);
      border-radius: 10px;
      padding: 12px;
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
      .spinner { animation: none; }
    }
  `;
}
