const DEFAULT_CONVERSATION_TITLE = "New Conversation";
const MAX_TITLE_LENGTH = 68;
const MIN_READABLE_CHARS = 3;

const COMMON_FILE_EXTENSIONS = [
  "astro",
  "bash",
  "c",
  "cc",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lock",
  "log",
  "lua",
  "md",
  "mdx",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
].join("|");

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
}

function stripFileReferences(text: string): string {
  return text
    .replace(/\b[A-Za-z]:[\\/][^\s),;]+/g, " ")
    .replace(
      /(?:^|\s)(?:~|\.{1,2}|\/)?(?:[\w.-]+[\\/])+[\w.-]+(?::\d+(?::\d+)?)?/g,
      " ",
    )
    .replace(
      new RegExp(
        `\\b[\\w.-]+\\.(?:${COMMON_FILE_EXTENSIONS})(?::\\d+(?::\\d+)?)?`,
        "gi",
      ),
      " ",
    );
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "");
}

function readableCharCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function isCodeOrLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^(>|\$|>|>>>|\.\.\.|at\s+|\+{3}|-{3}|@@|\[[\w:-]+\])/.test(trimmed)) {
    return true;
  }
  const punctuation = trimmed.replace(/[\p{L}\p{N}\s]/gu, "");
  return trimmed.length >= 8 && punctuation.length / trimmed.length > 0.45;
}

function normalizeCandidate(text: string): string {
  return stripFileReferences(stripUrls(stripMarkdown(text)))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(
      /^(please\s+)?(?:fix|update|change|edit|review|check|open|look at)\s+(?:and\s+)?(?=[\p{Lu}\p{N}])/iu,
      "",
    )
    .replace(/\b(?:in|at|from|for|and|or)\s+([,.;:!?])/giu, "$1")
    .replace(/\b(?:in|at|from|for|and|or)$/iu, "")
    .replace(/[([\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const match = text.match(/^(.{12,}?[.!?])(?:\s|$)/u);
  return (match?.[1] ?? text).trim();
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  const prefix = title.slice(0, MAX_TITLE_LENGTH - 1);
  const lastSpace = prefix.lastIndexOf(" ");
  const cut = lastSpace >= 36 ? prefix.slice(0, lastSpace) : prefix;
  return `${cut.replace(/[\s,;:.-]+$/u, "")}…`;
}

function finalClean(title: string): string {
  const cleaned = title
    .replace(/^[\s:;,.!?\-–—]+/u, "")
    .replace(/[\s:;,\-–—]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.replace(/^\p{Ll}/u, (char) => char.toLocaleUpperCase());
}

export function deriveConversationTitle(text: string): string {
  const withoutBlocks = stripCodeBlocks(text);
  const candidates = withoutBlocks
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => !isCodeOrLogLine(line))
    .map(normalizeCandidate)
    .filter((line) => readableCharCount(line) >= MIN_READABLE_CHARS);

  const source = candidates.find((line) => /[\p{L}\p{N}]/u.test(line)) ?? "";
  const title = finalClean(truncateTitle(firstSentence(source)));
  return title || DEFAULT_CONVERSATION_TITLE;
}
