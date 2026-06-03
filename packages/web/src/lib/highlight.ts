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
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang,
    themes: {
      light: "github-light",
      dark: "github-dark-dimmed",
    },
    defaultColor: false,
  });
}
