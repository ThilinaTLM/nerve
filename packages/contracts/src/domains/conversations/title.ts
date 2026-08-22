const DEFAULT_CONVERSATION_TITLE = "New Conversation";
const IMAGE_REVIEW_TITLE = "Image Review";
const FILE_REVIEW_TITLE = "File Review";
const LINK_REVIEW_TITLE = "Link Review";
const MAX_TITLE_CODE_POINTS = 80;
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

const ACTION_WORDS = [
  "add",
  "analyze",
  "audit",
  "build",
  "change",
  "check",
  "commit",
  "compare",
  "configure",
  "create",
  "debug",
  "deploy",
  "design",
  "disable",
  "document",
  "edit",
  "enable",
  "evaluate",
  "explain",
  "explore",
  "find",
  "fix",
  "generate",
  "implement",
  "improve",
  "inspect",
  "install",
  "investigate",
  "learn",
  "login",
  "make",
  "migrate",
  "open",
  "optimize",
  "push",
  "rebase",
  "refactor",
  "remove",
  "rename",
  "report",
  "research",
  "resolve",
  "review",
  "rewrite",
  "run",
  "set up",
  "show",
  "simplify",
  "stage",
  "test",
  "understand",
  "update",
  "upgrade",
  "use",
  "write",
];

const ACTION_PATTERN = ACTION_WORDS.join("|").replace(" ", "\\s+");
const LEADING_ACTION_RE = new RegExp(`^(?:${ACTION_PATTERN})(?:\\s|:|$)`, "iu");
const ANY_ACTION_RE = new RegExp(`\\b(?:${ACTION_PATTERN})\\b`, "iu");

interface TitleCandidate {
  text: string;
  sourceIndex: number;
  explicitEntity: boolean;
}

function fileReferencePattern(extensions = COMMON_FILE_EXTENSIONS): RegExp {
  return new RegExp(
    String.raw`(?:\b[A-Za-z]:[\\/][^\s),;]+|(?:^|\s)(?:~|\.{1,2}|/)?(?:[\w.-]+[\\/])+[\w.-]+(?::\d+(?::\d+)?)?|\b[\w.-]+\.(?:${extensions})(?::\d+(?::\d+)?)?)`,
    "i",
  );
}

function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, "\n")
    .replace(/~~~[\s\S]*?~~~/gu, "\n");
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+|www\.\S+/giu, " ");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[*_~]/gu, "")
    .replace(/^\s{0,3}#{1,6}\s+/gu, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gu, "");
}

function readableCharCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (
    /^(?:>|\$|>>>|\.\.\.|at\s+|\+{3}|-{3}|@@|\[[\w:-]+\]|exit code:|status:)/iu.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^(?:error|warn|info|debug)\s*\[[^\]]+\]/iu.test(trimmed)) return true;
  if (
    /^\d{4}-\d{2}-\d{2}[T\s]\S*\s+(?:error|warn|info|debug)\b/iu.test(trimmed)
  ) {
    return true;
  }
  const punctuation = trimmed.replace(/[\p{L}\p{N}\s]/gu, "");
  return trimmed.length >= 8 && punctuation.length / trimmed.length > 0.45;
}

function pathBasename(reference: string): string {
  const withoutLocation = reference.replace(/:\d+(?::\d+)?$/u, "");
  return withoutLocation.split(/[\\/]/u).filter(Boolean).at(-1) ?? reference;
}

function normalizePaths(text: string): string {
  return text
    .replace(/\b[A-Za-z]:[\\/][^\s),;]+/gu, (match) => pathBasename(match))
    .replace(
      /(?:~|\.{1,2}|\/)?(?:[\w.-]+[\\/])+[\w.-]+(?::\d+(?::\d+)?)?/gu,
      (match) => pathBasename(match),
    );
}

function collectExplicitEntities(text: string): Set<string> {
  const entities = new Set<string>();
  const add = (value: string) => {
    const normalized = pathBasename(value.trim()).toLocaleLowerCase();
    if (readableCharCount(normalized) >= 2) entities.add(normalized);
  };
  for (const match of text.matchAll(/[`'“”]([^`'“”]{2,80})[`'“”]/gu)) {
    add(match[1] ?? "");
  }
  const pathPattern = new RegExp(fileReferencePattern().source, "giu");
  for (const match of text.matchAll(pathPattern)) add(match[0]);
  for (const match of text.matchAll(
    /\b(?:[\p{Ll}\d]+[A-Z][\p{L}\p{N}]*|[A-Z][\p{Ll}\d]+(?:[A-Z][\p{L}\p{N}]*)+|[\p{L}\d]+_[\p{L}\d_]+|[\p{L}\d]+-[\p{L}\d-]+)\b/gu,
  )) {
    add(match[0]);
  }
  return entities;
}

function removeRequestPrefix(text: string): string {
  let value = text.trim();
  const prefix =
    /^(?:(?:so|also|currently|now|then)\s*,?\s+|(?:please|kindly)\s+|(?:can|could|would|will|should)\s+(?:you|we)\s+|(?:we|you)\s+should\s+|i\s+want\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+(?:you\s+)?to\s+|help\s+me\s+(?:to\s+)?|let(?:'s|\s+us)\s+)/iu;
  while (prefix.test(value)) value = value.replace(prefix, "").trim();
  return value;
}

function normalizeProse(text: string): string {
  return removeRequestPrefix(
    normalizePaths(stripUrls(stripMarkdown(text)))
      .replace(
        new RegExp(`^[\\w.-]+\\.(?:${IMAGE_FILE_EXTENSIONS})\\s+`, "iu"),
        "",
      )
      .replace(/[\r\n\t]+/gu, " ")
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.;:!?])/gu, "$1")
      .trim(),
  );
}

function sentenceFragments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function safeEnglishTransformation(text: string): string {
  const withoutPunctuation = text.replace(/[.!?]+$/gu, "").trim();
  const how = withoutPunctuation.match(
    /^how\s+(?:do|can|should|would)\s+(?:i|we|you)\s+(.+)$/iu,
  );
  if (how?.[1] && ANY_ACTION_RE.test(how[1])) return how[1];

  if (
    !/^(?:why|how|what|when|where|who)\b/iu.test(withoutPunctuation) &&
    !LEADING_ACTION_RE.test(withoutPunctuation)
  ) {
    const broken = withoutPunctuation.match(
      /^(.+?)\s+(?:is|are|keeps?\s+)?(?:broken|failing|fails|crashing|crashes)$/iu,
    );
    const subject = broken?.[1]?.replace(/\s+(?:is|are|keeps?)$/iu, "").trim();
    if (subject && readableCharCount(subject) >= 2) {
      return `Fix ${subject}`;
    }
  }
  return text;
}

function isLowInformation(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (readableCharCount(normalized) < MIN_READABLE_CHARS) return true;
  if (
    /^(?:request|context|question|task|issue|problem|help|thoughts|what do you think|wdyt)$/u.test(
      normalized,
    ) ||
    /^use agent browser\b.*\bdogfood skills\b/u.test(normalized)
  ) {
    return true;
  }
  if (
    /^(?:(?:please|can you|could you|would you)\s+)?(?:see|look|look at|check|review|open|inspect|read|fix|update|edit|change|help)$/u.test(
      normalized,
    )
  ) {
    return true;
  }
  return new RegExp(`^(?:${ACTION_PATTERN})\\s+(?:this|that|it)$`, "iu").test(
    normalized,
  );
}

function containsExplicitEntity(text: string, entities: Set<string>): boolean {
  const normalized = text.toLocaleLowerCase();
  return [...entities].some((entity) => normalized.includes(entity));
}

function isOnlyFileReference(text: string): boolean {
  const references = new RegExp(fileReferencePattern().source, "giu");
  return (
    text.replace(references, "").replace(/[\s:;,.!?()[\]{}-]+/gu, "") === ""
  );
}

function candidateFragments(
  text: string,
  entities: Set<string>,
): TitleCandidate[] {
  const candidates: TitleCandidate[] = [];
  let sourceIndex = 0;
  for (const line of stripCodeBlocks(text).split(/\r?\n+/u)) {
    const raw = line.trim();
    if (isNoiseLine(raw)) continue;
    if (hasFileReference(raw) && isOnlyFileReference(raw)) continue;
    const normalized = normalizeProse(raw);
    for (const fragment of sentenceFragments(normalized)) {
      const variants = [removeRequestPrefix(fragment)];
      for (const clause of fragment.split(/[,;:]\s+/u).slice(1)) {
        const normalizedClause = normalizeProse(clause);
        if (LEADING_ACTION_RE.test(normalizedClause))
          variants.push(normalizedClause);
      }
      for (const variant of variants) {
        const transformed = safeEnglishTransformation(variant);
        if (!isLowInformation(transformed)) {
          candidates.push({
            text: transformed,
            sourceIndex,
            explicitEntity: containsExplicitEntity(transformed, entities),
          });
        }
      }
      sourceIndex += 1;
    }
  }
  return candidates;
}

function scoreCandidate(candidate: TitleCandidate): number {
  const { text, sourceIndex, explicitEntity } = candidate;
  const words = wordCount(text);
  if (words === 0) return Number.NEGATIVE_INFINITY;

  let score = Math.min(words, 12) * 2;
  if (words > 16) score -= (words - 16) * 1.5;
  if (LEADING_ACTION_RE.test(text)) score += 36;
  else if (ANY_ACTION_RE.test(text)) score += 14;
  if (/^(?:how|what|why|when|where|who)\b/iu.test(text)) score += 12;
  if (explicitEntity) score += 12;
  if (
    /\b(?:bug|broken|crash|error|fail|failing|issue|problem)\b/iu.test(text)
  ) {
    score += 8;
  }
  if (
    /^(?:because|for context|here is|this is|i think|we need)\b/iu.test(text)
  ) {
    score -= 16;
  }
  if (words <= 2 && !LEADING_ACTION_RE.test(text) && !explicitEntity)
    score -= 12;
  return score - sourceIndex * 1.5;
}

function capitalizeSafely(text: string): string {
  const firstWord = text.match(/^[\p{L}\p{N}_-]+/u)?.[0] ?? "";
  if (/[A-Z_]/u.test(firstWord.slice(1))) return text;
  return text.replace(/^\p{Ll}/u, (character) => character.toLocaleUpperCase());
}

function truncateCodePoints(text: string): string {
  const points = Array.from(text);
  if (points.length <= MAX_TITLE_CODE_POINTS) return text;
  const window = points.slice(0, MAX_TITLE_CODE_POINTS + 1);
  let boundary = -1;
  for (let index = 0; index < MAX_TITLE_CODE_POINTS; index += 1) {
    if (/\s/u.test(window[index] ?? "")) boundary = index;
  }
  const end =
    boundary >= Math.floor(MAX_TITLE_CODE_POINTS / 2)
      ? boundary
      : MAX_TITLE_CODE_POINTS;
  return window.slice(0, end).join("").trimEnd();
}

function finalClean(title: string): string {
  const cleaned = title
    .replace(/^[\s:;,.!?\-–—]+/u, "")
    .replace(/[\s:;,.!?。！？\-–—]+$/u, "")
    .replace(/\b([\p{L}\p{N}_-]+)(?:\s+\1\b)+/giu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return "";
  return truncateCodePoints(capitalizeSafely(cleaned))
    .replace(/[\s:;,.!?。！？\-–—]+$/u, "")
    .trim();
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
  return /https?:\/\/\S+|www\.\S+/iu.test(text);
}

function fallbackTitle(text: string): string {
  if (hasUrlReference(text)) return LINK_REVIEW_TITLE;
  if (hasImageReference(text)) return IMAGE_REVIEW_TITLE;
  if (hasFileReference(text)) return FILE_REVIEW_TITLE;
  return DEFAULT_CONVERSATION_TITLE;
}

export function deriveConversationTitle(text: string): string {
  const entities = collectExplicitEntities(text);
  const candidates = candidateFragments(text, entities);
  let best: TitleCandidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return (best && finalClean(best.text)) || fallbackTitle(text);
}

export function expandTruncatedConversationTitle(
  existingTitle: string,
  firstUserText: string,
): string | undefined {
  const existing = existingTitle.trim();
  if (!/(?:…|\.\.\.)$/u.test(existing)) return undefined;

  const expanded = deriveConversationTitle(firstUserText);
  if (expanded.length <= existing.length) return undefined;

  const stem = existing
    .replace(/\s*(?:…|\.\.\.)$/u, "")
    .replace(/[\s,;:.-]+$/u, "")
    .trim();
  if (readableCharCount(stem) < MIN_READABLE_CHARS) return undefined;

  return expanded.startsWith(stem) ? expanded : undefined;
}
