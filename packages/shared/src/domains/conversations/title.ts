const DEFAULT_CONVERSATION_TITLE = "New Conversation";
const IMAGE_REVIEW_TITLE = "Image Review";
const FILE_REVIEW_TITLE = "File Review";
const LINK_REVIEW_TITLE = "Link Review";
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
  "jpeg",
  "jpg",
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
  "png",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "webp",
  "xml",
  "yaml",
  "yml",
].join("|");

const IMAGE_FILE_EXTENSIONS = [
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tiff",
  "webp",
].join("|");

function fileReferencePattern(extensions = COMMON_FILE_EXTENSIONS): RegExp {
  return new RegExp(
    String.raw`(?:\b[A-Za-z]:[\\/][^\s),;]+|(?:^|\s)(?:~|\.{1,2}|/)?(?:[\w.-]+[\\/])+[\w.-]+(?::\d+(?::\d+)?)?|\b[\w.-]+\.(?:${extensions})(?::\d+(?::\d+)?)?)`,
    "i",
  );
}

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

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function isCodeOrLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^(>|\$|>>>|\.\.\.|at\s+|\+{3}|-{3}|@@|\[[\w:-]+\])/.test(trimmed)) {
    return true;
  }
  const punctuation = trimmed.replace(/[\p{L}\p{N}\s]/gu, "");
  return trimmed.length >= 8 && punctuation.length / trimmed.length > 0.45;
}

function normalizeCandidate(text: string): string {
  return stripFileReferences(stripUrls(stripMarkdown(text)))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\btoolcall\b/giu, "tool call")
    .replace(
      /\bthe similar UI to the write and edit tool calls?\b/giu,
      "similar UI for write and edit tool calls",
    )
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^(?:i\s+think\s+)?(?:we\s+)?should\s+(?=[\p{L}\p{N}])/iu, "")
    .replace(/^please\s+(?=[\p{L}\p{N}])/iu, "")
    .replace(
      /^(?:fix|update|change|edit|review|check|open|look at)\s+(?:and\s+)?(?=[\p{Lu}\p{N}])/iu,
      "",
    )
    .replace(/\b(?:in|at|from|for|and|or)\s+([,.;:!?])/giu, "$1")
    .replace(/\b(?:in|at|from|for|and|or)$/iu, "")
    .replace(/[([\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceFragments(text: string): string[] {
  const fragments = text.match(/[^.!?]+[.!?]?/gu) ?? [text];
  return fragments.map((fragment) => fragment.trim()).filter(Boolean);
}

function candidateFragments(text: string): string[] {
  const withoutBlocks = stripCodeBlocks(text);
  const fragments: string[] = [];
  for (const line of withoutBlocks.split(/\r?\n+/)) {
    const trimmed = line.trim();
    if (isCodeOrLogLine(trimmed)) continue;
    const normalized = normalizeCandidate(trimmed);
    for (const fragment of sentenceFragments(normalized)) {
      fragments.push(normalizeCandidate(fragment));
    }
  }
  return fragments;
}

function isLowInformationCandidate(candidate: string): boolean {
  const normalized = candidate
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  if (readableCharCount(normalized) < MIN_READABLE_CHARS) return true;
  if (/^(?:what do you think|thoughts|wdyt)$/u.test(normalized)) return true;
  if (
    /^(?:(?:please|can you|could you|would you)\s+)?(?:see|look|look at|check|review|open|inspect|read|fix|update|edit|change|help)$/u.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    wordCount(normalized) <= 2 &&
    /^(?:please\s+)?(?:see|look|check|review|open|inspect|read)\b/u.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function scoreCandidate(candidate: string, index: number): number {
  if (isLowInformationCandidate(candidate)) return Number.NEGATIVE_INFINITY;

  const words = wordCount(candidate);
  if (words < 3) return Number.NEGATIVE_INFINITY;

  let score = Math.min(words, 12) * 2;
  if (words > 16) score -= (words - 16) * 1.5;

  if (
    /\b(?:improve|fix|update|change|edit|review|redesign|test|build|add|remove|show|generate|write|create|make|debug|investigate|explain|compare|refactor|implement)\b/iu.test(
      candidate,
    )
  ) {
    score += 20;
  }
  if (
    /^(?:improve|fix|update|change|edit|review|redesign|test|build|add|remove|show|generate|write|create|make|debug|investigate|explain|compare|refactor|implement)\b/iu.test(
      candidate,
    )
  ) {
    score += 16;
  }
  if (
    /\b(?:ui|tool|call|title|conversation|settings|error|issue|bug|status|display|page|component|api|name)\b/iu.test(
      candidate,
    )
  ) {
    score += 8;
  }
  if (
    /\b(?:broken|hard|slow|fail|fails|error|issue|problem|confusing|unclear)\b/iu.test(
      candidate,
    )
  ) {
    score += 8;
  }
  if (/^(?:because|sometime|sometimes|here is|this is)\b/iu.test(candidate)) {
    score -= 12;
  }

  return score - index * 0.1;
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

function hasImageReference(text: string): boolean {
  return new RegExp(
    String.raw`(?:!\[[^\]]*\]\([^)]*\.(?:${IMAGE_FILE_EXTENSIONS})(?:[?#][^)]*)?\)|\b[A-Za-z]:[\\/][^\s),;]+\.(?:${IMAGE_FILE_EXTENSIONS})(?::\d+(?::\d+)?)?|(?:^|\s)(?:~|\.{1,2}|/)?(?:[\w.-]+[\\/])+[\w.-]+\.(?:${IMAGE_FILE_EXTENSIONS})(?::\d+(?::\d+)?)?|\b[\w.-]+\.(?:${IMAGE_FILE_EXTENSIONS})(?::\d+(?::\d+)?)?)`,
    "i",
  ).test(text);
}

function hasFileReference(text: string): boolean {
  return fileReferencePattern().test(text);
}

function hasUrlReference(text: string): boolean {
  return /https?:\/\/\S+|www\.\S+/i.test(text);
}

function fallbackTitle(text: string): string {
  if (hasImageReference(text)) return IMAGE_REVIEW_TITLE;
  if (hasFileReference(text)) return FILE_REVIEW_TITLE;
  if (hasUrlReference(text)) return LINK_REVIEW_TITLE;
  return DEFAULT_CONVERSATION_TITLE;
}

export function deriveConversationTitle(text: string): string {
  const candidates = candidateFragments(text)
    .map((candidate) => finalClean(truncateTitle(firstSentence(candidate))))
    .filter((candidate) => readableCharCount(candidate) >= MIN_READABLE_CHARS);

  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    const score = scoreCandidate(candidate, index);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best || fallbackTitle(text);
}
