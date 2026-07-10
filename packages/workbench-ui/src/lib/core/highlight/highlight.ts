import { LruCache } from "@nervekit/workbench-ui/core/utils/lru-cache";

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
  yaml: () => import("@shikijs/langs/yaml"),
} as const;

const themeLoaders = {
  "github-light": () => import("@shikijs/themes/github-light"),
  "github-dark-dimmed": () => import("@shikijs/themes/github-dark-dimmed"),
} as const;

type HighlightLanguage = keyof typeof languageLoaders;
type HighlightTheme = keyof typeof themeLoaders;
type HighlighterLike = {
  codeToHtml: (
    code: string,
    options: {
      lang: HighlightLanguage;
      themes: { light: HighlightTheme; dark: HighlightTheme };
      defaultColor: false;
    },
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
// Bounded so long sessions with many unique code/tool blocks don't grow the
// cache without limit. Stores resolved HTML (and in-flight promises) by
// `${lang}\0${code}`.
const highlightCache = new LruCache<
  string,
  string | Promise<string | undefined> | undefined
>(500);

export type HighlightCodeResult =
  | string
  | Promise<string | undefined>
  | undefined;

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

export async function highlightCode(
  code: string,
  language: string | undefined,
): Promise<string | undefined> {
  const lang = normalizeHighlightLanguage(language);
  if (!lang) return undefined;
  return runWhenIdle(async () => {
    const highlighter = await getHighlighter();
    return highlighter.codeToHtml(code, {
      lang,
      themes: {
        light: "github-light",
        dark: "github-dark-dimmed",
      },
      defaultColor: false,
    });
  });
}

function highlightCacheKey(code: string, lang: HighlightLanguage): string {
  return `${lang}\0${code}`;
}

export function highlightCodeCached(
  code: string,
  language: string | undefined,
): HighlightCodeResult {
  const lang = normalizeHighlightLanguage(language);
  if (!lang) return undefined;

  const key = highlightCacheKey(code, lang);
  const cached = highlightCache.get(key);
  if (cached !== undefined || highlightCache.has(key)) return cached;

  const promise = highlightCode(code, lang)
    .then((result) => {
      highlightCache.set(key, result);
      return result;
    })
    .catch(() => {
      highlightCache.delete(key);
      return undefined;
    });
  highlightCache.set(key, promise);
  return promise;
}
