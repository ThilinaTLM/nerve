const extensionLanguage: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  html: "html",
  svelte: "svelte",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "shellscript",
};

/** Map a file path to a highlight language understood by `highlightCode`. */
export function extname(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return extensionLanguage[ext];
}
