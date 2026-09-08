import { LruCache } from "@nervekit/ui-kit/collections/lru-cache";
import { isWithinHighlightBudget } from "./highlight-policy";
import {
  createHighlightQueue,
  type HighlightQueueLease,
} from "./highlight-queue";
import { SYNTAX_THEME_NAME, syntaxTheme } from "./syntax-theme";

const languageLoaders = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  html: () => import("@shikijs/langs/html"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  svelte: () => import("@shikijs/langs/svelte"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const;

// One theme for every colour theme and mode: its colours are `--syntax-*` CSS
// variables, so the palette is chosen at paint time rather than at tokenize
// time. Nothing here has to reload when the user switches themes.
const themeLoaders = {
  [SYNTAX_THEME_NAME]: () => Promise.resolve(syntaxTheme),
} as const;

type HighlightLanguage = keyof typeof languageLoaders;
type HighlightTheme = keyof typeof themeLoaders;
type HighlighterLike = {
  codeToHtml: (
    code: string,
    options: { lang: HighlightLanguage; theme: HighlightTheme },
  ) => Promise<string>;
};

const languageAliases = new Map<string, HighlightLanguage>([
  ["", "markdown"],
  ["text", "markdown"],
  ["plain", "markdown"],
  ["plaintext", "markdown"],
  ["sh", "bash"],
  ["shell", "shellscript"],
  ["zsh", "shellscript"],
  ["js", "javascript"],
  ["ts", "typescript"],
  ["md", "markdown"],
  ["yml", "yaml"],
]);

const supported = new Set<string>(Object.keys(languageLoaders));
let highlighterPromise: Promise<HighlighterLike> | undefined;
const resolvedHighlightCache = new LruCache<string, string>(500);
const HIGHLIGHT_SETTLE_DELAY_MS = 500;

export type HighlightCodeResult =
  | string
  | Promise<string | undefined>
  | undefined;

export type HighlightCodeLease = HighlightQueueLease<string>;

export function normalizeHighlightLanguage(
  language: string | undefined,
): HighlightLanguage | undefined {
  const normalized = (language ?? "").toLowerCase().trim();
  const alias = languageAliases.get(normalized);
  if (alias) return alias;
  return supported.has(normalized)
    ? (normalized as HighlightLanguage)
    : undefined;
}

export function canHighlight(language: string | undefined): boolean {
  return Boolean(normalizeHighlightLanguage(language));
}

function runWhenIdle<T>(task: () => Promise<T>): Promise<T> {
  if (
    typeof window === "undefined" ||
    typeof window.requestIdleCallback !== "function"
  ) {
    return task();
  }

  return new Promise((resolve, reject) => {
    window.requestIdleCallback(
      () => {
        void task().then(resolve, reject);
      },
      { timeout: 750 },
    );
  });
}

function scheduleWhenIdle(start: () => void): void {
  if (typeof window === "undefined") {
    queueMicrotask(start);
    return;
  }

  // Virtual rows commonly remain mounted for only a few frames while the user
  // scrolls. Let that churn settle before claiming renderer time; leases will
  // cancel jobs whose rows disappear during this window.
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 750 });
    } else {
      start();
    }
  }, HIGHLIGHT_SETTLE_DELAY_MS);
}

async function getHighlighter(): Promise<HighlighterLike> {
  highlighterPromise ??= Promise.all([
    import("@shikijs/core"),
    import("@shikijs/engine-javascript"),
  ]).then(([core, engine]) => {
    const createHighlighter = core.createBundledHighlighter<
      HighlightLanguage,
      HighlightTheme
    >({
      langs: languageLoaders,
      themes: themeLoaders,
      engine: () => engine.createJavaScriptRegexEngine(),
    });
    return core.createSingletonShorthands(createHighlighter);
  });
  return highlighterPromise;
}

async function performHighlight(
  code: string,
  lang: HighlightLanguage,
): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, { lang, theme: SYNTAX_THEME_NAME });
}

export async function highlightCode(
  code: string,
  language: string | undefined,
): Promise<string | undefined> {
  const lang = normalizeHighlightLanguage(language);
  if (!lang || !isWithinHighlightBudget(code)) return undefined;
  return runWhenIdle(() => performHighlight(code, lang));
}

/**
 * Highlighted markup carries CSS variables rather than resolved colours, so a
 * cached result stays valid under every theme and colour mode.
 */
export function highlightCacheKey(
  code: string,
  lang: HighlightLanguage,
): string {
  return `${lang}\0${code}`;
}

function splitHighlightCacheKey(key: string): {
  code: string;
  lang: HighlightLanguage;
} {
  const langEnd = key.indexOf("\0");
  return {
    lang: key.slice(0, langEnd) as HighlightLanguage,
    code: key.slice(langEnd + 1),
  };
}

const highlightQueue = createHighlightQueue<string>({
  load: (key) => {
    const { code, lang } = splitHighlightCacheKey(key);
    return performHighlight(code, lang);
  },
  schedule: scheduleWhenIdle,
  lookup: (key) => ({
    hit: resolvedHighlightCache.has(key),
    value: resolvedHighlightCache.get(key),
  }),
  store: (key, value) => resolvedHighlightCache.set(key, value),
});

/**
 * Acquires shared highlighting work. Releasing before queued work starts lets
 * virtualized callers cancel obsolete offscreen tokenization.
 */
export function acquireHighlightCode(
  code: string,
  language: string | undefined,
): HighlightCodeLease {
  const lang = normalizeHighlightLanguage(language);
  if (!lang || !isWithinHighlightBudget(code)) {
    return { result: undefined, release: () => undefined };
  }
  return highlightQueue.acquire(highlightCacheKey(code, lang));
}

/** Cached highlighting for non-cancellable consumers such as Markdown. */
export function highlightCodeCached(
  code: string,
  language: string | undefined,
): HighlightCodeResult {
  return acquireHighlightCode(code, language).result;
}
