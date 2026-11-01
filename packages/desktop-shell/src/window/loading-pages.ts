import { DaemonStartupError } from "../daemon/diagnostics.js";
import { homeAdmissionFailureKind } from "@nervekit/contracts/settings";
import {
  STARTUP_SPLASH_STYLES,
  startupSplashMarkup,
} from "./startup-splash-document.js";
import { escapeHtml } from "./html.js";
import {
  DEFAULT_WINDOW_APPEARANCE,
  type WindowAppearance,
} from "./window-appearance.js";

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

export interface LoadingPageOptions {
  status?: string;
  /** The renderer's last reported theme; defaults to the nerve-dark theme. */
  appearance?: WindowAppearance;
}

export function loadingHtml(options: LoadingPageOptions = {}): string {
  const { status = "Starting local services", appearance } = options;
  return `<!doctype html>
<html lang="en" ${modeAttribute(appearance)}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:" />
    <title>Nerve</title>
    <style>${shellStyles(appearance)}</style>
  </head>
  <body>
${startupSplashMarkup(status)}
  </body>
</html>`;
}

export interface ErrorPageOptions {
  retry?: boolean;
  title?: string;
  summary?: string;
  appearance?: WindowAppearance;
}

export function startupErrorRetryable(error: unknown): boolean {
  if (homeAdmissionFailureKind(error)) return false;
  const failure = structuredStartupFailure(error);
  return failure
    ? failure.retryable
    : error instanceof DaemonStartupError && error.retryable;
}

export function errorHtml(
  error: unknown,
  dataDir = "~/.nerve",
  options: ErrorPageOptions = {},
): string {
  const admission = homeAdmissionFailureKind(error);
  const failure = structuredStartupFailure(error);
  const message = failure
    ? [
        failure.message,
        `Code: ${failure.code}`,
        `Phase: ${failure.phase}`,
        failure.stepId ? `Step: ${failure.stepId}` : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    : error instanceof Error
      ? error.message
      : String(error);
  const daemonOutput =
    error !== null &&
    typeof error === "object" &&
    "daemonOutput" in error &&
    typeof error.daemonOutput === "string"
      ? error.daemonOutput
      : undefined;
  const diagnostics =
    daemonOutput && !message.includes(daemonOutput)
      ? `${message}\n\nDaemon output:\n${daemonOutput}`
      : message;
  const retry = !admission && (options.retry ?? failure?.retryable ?? false);
  const title =
    options.title ??
    (admission === "too_old"
      ? "This Nerve home needs an older upgrade"
      : admission
        ? "This Nerve home could not be opened"
        : "Nerve is unavailable");
  const summary =
    options.summary ??
    (admission === "too_old"
      ? "To keep your conversation history, run Nerve 0.34.1 once, then reopen this version."
      : admission
        ? "The home metadata is damaged or unrecognized."
        : retry
          ? "Nerve could not connect to its local service. You can try again without closing the app."
          : "Nerve lost its connection to the local service. Technical details are available below.");
  const escapedDataDir = escapeHtml(dataDir);
  const damaged = admission !== undefined && admission !== "too_old";
  const admissionMarkup = admission
    ? `<p class="diagnostic-location">Home folder: ${escapedDataDir}</p>
    <p>Close Nerve, delete or move this folder, then reopen Nerve to start with an empty home.</p>
    ${damaged ? '<button id="open-home" type="button">Open folder</button><button id="copy-diagnostics" type="button">Copy diagnostics</button>' : ""}`
    : "";
  const admissionScript = damaged
    ? `<script>
    document.getElementById("open-home")?.addEventListener("click", () => window.nerveDesktop?.app.openHomeFolder());
    document.getElementById("copy-diagnostics")?.addEventListener("click", () => window.nerveDesktop?.app.copyStartupDiagnostics());
  </script>`
    : "";
  const retryMarkup = retry
    ? `<button id="startup-retry" type="button">Try again</button>`
    : "";
  const retryScript = retry
    ? `<script>
      document.getElementById("startup-retry")?.addEventListener("click", () => {
        const button = document.getElementById("startup-retry");
        if (button instanceof HTMLButtonElement) button.disabled = true;
        const status = document.getElementById("startup-error-status");
        if (status) status.textContent = "Trying again…";
        const reset = () => {
          if (button instanceof HTMLButtonElement) button.disabled = false;
          if (status) status.textContent = "Retry could not be started. Please try again.";
        };
        Promise.resolve(window.nerveDesktop?.app.retryStartup())
          .then((result) => { if (!result?.accepted) reset(); })
          .catch(reset);
      });
    </script>`
    : "";
  return `<!doctype html>
<html lang="en" ${modeAttribute(options.appearance)}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${retry || damaged ? "script-src 'unsafe-inline'; " : ""}style-src 'unsafe-inline'; img-src data:" />
    <title>Nerve startup error</title>
    <style>${shellStyles(options.appearance)}</style>
  </head>
  <body>
    <main class="error">
      <h1 class="error-title">${escapeHtml(title)}</h1>
      <p id="startup-error-status" class="status">${escapeHtml(summary)}</p>
      ${retryMarkup}
      ${admissionMarkup}
      <details>
        <summary>Technical details</summary>
        <p class="diagnostic-location">Logs: ${escapedDataDir}/logs</p>
        <pre>${escapeHtml(diagnostics)}</pre>
      </details>
    </main>
    ${retryScript}
    ${admissionScript}
  </body>
</html>`;
}

interface StructuredStartupFailure {
  code: string;
  phase: string;
  message: string;
  retryable: boolean;
  stepId?: string;
}

function structuredStartupFailure(
  error: unknown,
): StructuredStartupFailure | undefined {
  if (error === null || typeof error !== "object" || !("failure" in error)) {
    return undefined;
  }
  const failure = error.failure;
  if (
    failure === null ||
    typeof failure !== "object" ||
    !("code" in failure) ||
    typeof failure.code !== "string" ||
    !("phase" in failure) ||
    typeof failure.phase !== "string" ||
    !("message" in failure) ||
    typeof failure.message !== "string" ||
    !("retryable" in failure) ||
    typeof failure.retryable !== "boolean"
  ) {
    return undefined;
  }
  return {
    code: failure.code,
    phase: failure.phase,
    message: failure.message,
    retryable: failure.retryable,
    stepId:
      "stepId" in failure && typeof failure.stepId === "string"
        ? failure.stepId
        : undefined,
  };
}

function modeAttribute(appearance = DEFAULT_WINDOW_APPEARANCE): string {
  return `data-mode="${appearance.dark ? "dark" : "light"}"`;
}

function shellStyles(appearance = DEFAULT_WINDOW_APPEARANCE): string {
  // Mirrors the shadcn theme tokens from packages/ui-kit/src/styles/theme.css
  // so the pre-daemon shell matches the workbench in both light and dark.
  return `
    :root {
      color-scheme: light;
      --background: oklch(0.979 0.012 92);
      --foreground: oklch(0.3438 0.0269 95.7);
      --primary: oklch(0.57 0.1375 39);
      --muted-foreground: oklch(0.4899 0.02347 95.27);
      --border: oklch(0.871 0.01453 93.16);
      --destructive: oklch(0.5 0.19 27);
      --radius: 0.375rem;
      --radius-lg: 0.375rem;
      --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --text-ui: 0.8125rem;
      --text-title: 1rem;
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
    :root[data-mode="dark"] {
        color-scheme: dark;
        --background: oklch(0.264 0.018 80);
        --foreground: oklch(0.9 0.012 95);
        --primary: oklch(0.6724 0.1308 38.8);
        --muted-foreground: oklch(0.7919 0.01294 91.49);
        --border: oklch(0.3848 0.01679 82.01);
        --destructive: oklch(0.8 0.114 25.5);
    }
    /* The active theme's own background, which may differ from nerve-dark/light. */
    :root[data-mode] { --background: ${appearance.background}; }
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
      font-size: var(--text-title);
      font-weight: 600;
      line-height: 1.5rem;
      letter-spacing: -0.025em;
    }
    .status {
      margin: 0;
      color: var(--muted-foreground);
      font-size: var(--text-ui);
      line-height: 1.625;
    }
    .error {
      gap: 1rem;
    }
    button {
      min-height: 2rem;
      border: 0;
      border-radius: var(--radius);
      padding: 0.375rem 0.875rem;
      background: var(--primary);
      color: var(--background);
      font: inherit;
      font-size: var(--text-ui);
      font-weight: 600;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    button:disabled { opacity: 0.6; cursor: default; }
    details {
      width: 100%;
      color: var(--muted-foreground);
      font-size: var(--text-ui);
      text-align: left;
      user-select: text;
      -webkit-app-region: no-drag;
    }
    summary { cursor: pointer; text-align: center; }
    .diagnostic-location { margin: 0.75rem 0 0; }
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
      font-size: var(--text-ui);
      line-height: 1.5;
    }
    ${STARTUP_SPLASH_STYLES}
  `;
}
