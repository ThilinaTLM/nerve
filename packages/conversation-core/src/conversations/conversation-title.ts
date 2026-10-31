import {
  IMAGE_FILE_EXTENSIONS,
  hasImageReference,
  normalizeTitleImages,
} from "./conversation-title-images.js";
import { CONVERSATION_TITLE_IMAGE_MARKER } from "@nervekit/contracts/core";
const DEFAULT_CONVERSATION_TITLE = "New Conversation";
const IMAGE_REVIEW_TITLE = "Image Review";
const FILE_REVIEW_TITLE = "File Review";
const LINK_REVIEW_TITLE = "Link Review";
const GENERAL_CHAT_TITLE = "General Chat";
const MAX_TITLE_CODE_POINTS = 100;
const SOFT_TITLE_CODE_POINTS = 70;
const MAX_INPUT_LENGTH = 32_768;
const PLACEHOLDER = /\uE000(\d+)\uE001/gu;

interface TitleReference {
  display: string;
  identity: string;
  label?: string;
}

function placeholder(index: number): string {
  return `\uE000${index}\uE001`;
}

function readableUrlSegment(segment: string): boolean {
  return (
    segment.length >= 1 &&
    segment.length <= 28 &&
    /^[\p{L}][\p{L}\p{N}._-]*$/u.test(segment) &&
    !/^[a-f\d]{8,}$/iu.test(segment) &&
    !/[a-z][A-Z].*[a-z][A-Z]/u.test(segment) &&
    (segment.match(/\d/gu)?.length ?? 0) < segment.length / 3
  );
}

function recognizeUrl(raw: string): TitleReference | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo, kind, id] = parts;
    if (
      (url.hostname === "github.com" || url.hostname === "www.github.com") &&
      owner &&
      repo &&
      id
    ) {
      if ((kind === "pull" || kind === "issues") && /^\d+$/u.test(id)) {
        return {
          display: `${kind === "pull" ? "PR" : "issue"} ${owner}/${repo}#${id}`,
          identity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}/${kind}/${id}`,
        };
      }
      if (kind === "commit" && /^[a-f\d]{7,40}$/iu.test(id)) {
        return {
          display: `commit ${owner}/${repo}@${id.slice(0, 7)}`,
          identity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}/commit/${id.toLowerCase()}`,
        };
      }
    }
    const ticket = url.pathname.match(
      /^\/(?:jira\/)?browse\/([A-Z][A-Z\d]*-\d+)(?:\/|$)/u,
    )?.[1];
    if (ticket) return { display: ticket, identity: `${url.host}:${ticket}` };
    const segments: string[] = [];
    for (const segment of parts.slice(0, 2)) {
      if (
        !readableUrlSegment(segment) ||
        (segment === "d" && parts[0] === "file")
      )
        break;
      segments.push(segment);
    }
    const display = [url.host.replace(/^www\./u, ""), ...segments].join("/");
    // Identity deliberately excludes credentials, query strings and fragments.
    return { display, identity: `${url.host}${url.pathname}` };
  } catch {
    return;
  }
}

function descriptiveLabel(
  label: string,
  reference: TitleReference,
): string | undefined {
  const plain = stripMarkdown(label).trim();
  if (/^(?:this|here|link|pr|the pr|issue|commit)$/iu.test(plain)) return;
  const identifier = reference.display.replace(/^(?:PR|issue|commit) /u, "");
  if (
    plain.toLowerCase().includes(identifier.toLowerCase()) ||
    /^(?:#?\d+|https?:\/\/\S+)$/iu.test(plain)
  )
    return;
  return plain || undefined;
}

/** Protect references before any destructive prose normalization. */
function protectReferences(input: string): {
  text: string;
  references: TitleReference[];
} {
  const references: TitleReference[] = [];
  const record = (reference: TitleReference): string => {
    references.push(reference);
    return placeholder(references.length - 1);
  };
  let text = normalizeTitleImages(stripCodeBlocks(input)).replaceAll(
    CONVERSATION_TITLE_IMAGE_MARKER,
    () =>
      record({ display: CONVERSATION_TITLE_IMAGE_MARKER, identity: "image" }),
  );
  text = text.replace(
    /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/giu,
    (original, label: string, destination: string) => {
      const reference = recognizeUrl(destination);
      return reference
        ? record({ ...reference, label: descriptiveLabel(label, reference) })
        : original;
    },
  );
  text = text.replace(/<?`?https?:\/\/[^\s<>`]+`?>?/giu, (raw) => {
    const url = raw.replace(/^[<`]+|[>`]+$/gu, "");
    const suffix = url.match(/[.,;!?)]+$/u)?.[0] ?? "";
    const reference = recognizeUrl(suffix ? url.slice(0, -suffix.length) : url);
    return reference ? record(reference) + suffix : raw;
  });
  text = text.replace(/\b[\w.-]+\/[\w.-]+#\d+\b/gu, (display) =>
    record({ display, identity: `shorthand:${display}` }),
  );

  text = protectMentions(text, record);
  text = protectPaths(text, record, references);
  return { text, references };
}

function protectMentions(
  text: string,
  record: (reference: TitleReference) => string,
): string {
  // Move meaningful mentions to the referring pronoun, whether they precede or follow it.
  const mentions: string[] = [];
  text = text.replace(
    /(^|\s)@([^\s,;!?]+)/gu,
    (_raw, space: string, token: string) => {
      const display = token.replace(/[.]$/u, "");
      // Composer skill/command references are instructions, not file identity.
      if (/^\w+:[^/\\:]+$/u.test(display)) return space;
      if (
        /^(?:image-(?:\d{8}T\d{6}(?:\.\d+)?Z|\d{10,17}|…\d{6}Z)|pasted[-_]file-.+)\.[\w]+$/iu.test(
          display,
        )
      )
        return space;
      const marker = record({ display, identity: `mention:${display}` });
      mentions.push(marker);
      return `${space}${marker}`;
    },
  );
  if (mentions.length) {
    const pronoun = /\b(?:this|these|it)\b/iu;
    if (pronoun.test(text)) {
      for (const marker of mentions) text = text.replace(marker, "");
      text = text.replace(pronoun, mentions.join(" and "));
    }
  }

  return text;
}

function protectPaths(
  text: string,
  record: (reference: TitleReference) => string,
  references: TitleReference[],
): string {
  // Compute suffixes across the whole prompt, not independently per sentence.
  const pathPattern =
    /(?:[A-Za-z]:[\\/]|(?:~|\.{1,2}|\/)?)(?:[\w.-]+[\\/])+[\w.-]*[\w-](?::\d+(?::\d+)?)?/gu;
  const mentionedPaths = references.filter(
    (reference) =>
      reference.identity.startsWith("mention:") &&
      /[\\/]/u.test(reference.display) &&
      !/[\\/]$/u.test(reference.display),
  );
  const paths = [
    ...new Set([
      ...(text.match(pathPattern) ?? []),
      ...mentionedPaths.map((reference) => reference.display),
    ]),
  ];
  const parts = paths.map((path) =>
    path
      .replace(/:\d+(?::\d+)?$/u, "")
      .split(/[\\/]/u)
      .filter(Boolean),
  );
  const suffixCounts = new Map<string, number>();
  for (const segments of parts) {
    for (let count = 1; count <= Math.min(3, segments.length); count++) {
      const suffix = segments.slice(-count).join("/");
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  }
  const displays = new Map(
    paths.map((path, index) => {
      const segments = parts[index] ?? [];
      let count = 1;
      while (
        count < Math.min(3, segments.length) &&
        (suffixCounts.get(segments.slice(-count).join("/")) ?? 0) > 1
      )
        count++;
      return [path, segments.slice(-count).join("/")];
    }),
  );
  for (const reference of mentionedPaths)
    reference.display = displays.get(reference.display) ?? reference.display;
  text = text
    .split("\n")
    .map((line) => {
      // Preserve the existing File/Image Review fallback for path-only prompts.
      if (hasFileReference(line) && isOnlyFileReference(line)) return line;
      return line.replace(pathPattern, (path) =>
        record({
          display: displays.get(path) ?? path,
          identity: `path:${path}`,
        }),
      );
    })
    .join("\n");
  return text;
}
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
    .replace(/~~~[\s\S]*?~~~/gu, "\n")
    .replace(/(?:```|~~~)[\s\S]*$/u, "\n");
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
  const prose = trimmed.replace(PLACEHOLDER, "reference");
  const punctuation = prose.replace(/[\p{L}\p{N}\s]/gu, "");
  return trimmed.length >= 8 && punctuation.length / prose.length > 0.45;
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
    /^(?:(?:so|also|btw|by\s+the\s+way|ok|okay|currently|now|then)\s*,?\s+|i\s+think\s+|(?:please|kindly)\s+|(?:can|could|would|will|should|shall)\s+(?:you|we)\s+|(?:we|you)\s+should\s+|i\s+want\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+(?:you\s+)?to\s+|help\s+me\s+(?:to\s+)?|let(?:'s|\s+us)\s+)/iu;
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
      .replace(/\boutofdate\b/giu, "out of date")
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
    const outdated = withoutPunctuation.match(
      /^the\s+(.+?)\s+(is|are)\s+(?:out\s+of\s+date|outdated)$/iu,
    );
    if (outdated?.[1] && outdated[2]) {
      return `${outdated[1]} ${outdated[2]} out of date`;
    }
    const broken = withoutPunctuation.match(
      /^(.+?)\s+(?:is|are|keeps?\s+)?(?:broken|failing|fails|crashing|crashes)$/iu,
    );
    const subject = broken?.[1]?.replace(/\s+(?:is|are|keeps?)$/iu, "").trim();
    if (
      subject &&
      (readableCharCount(subject) >= 2 || /\uE000\d+\uE001/u.test(subject))
    ) {
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
  return new RegExp(
    `^(?:${ACTION_PATTERN})\\s+(?:this|that|it|them|these|those)(?:\\s+(?:please|for me))?$`,
    "iu",
  ).test(normalized);
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
        if (
          /\uE000\d+\uE001/u.test(transformed) ||
          !isLowInformation(transformed)
        ) {
          candidates.push({
            text: transformed,
            sourceIndex,
            explicitEntity:
              /\uE000\d+\uE001/u.test(transformed) ||
              containsExplicitEntity(transformed, entities),
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
  const words = wordCount(text.replace(PLACEHOLDER, "reference"));
  if (words === 0) return Number.NEGATIVE_INFINITY;

  let score = Math.min(words, 12) * 2;
  if (words > 16) score -= (words - 16) * 1.5;
  if (LEADING_ACTION_RE.test(text)) score += 36;
  else if (ANY_ACTION_RE.test(text)) score += 14;
  if (/^(?:how|what|why|when|where|who)\b/iu.test(text)) score += 12;
  if (explicitEntity) score += 12;
  if (
    /\b(?:bug|broken|crash|error|fail|failing|issue|out of date|outdated|problem)\b/iu.test(
      text,
    )
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

function codePoints(text: string): number {
  return Array.from(text).length;
}

function graphemeCut(text: string, limit: number): string {
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    if (codePoints(result) + codePoints(segment) > limit) break;
    result += segment;
  }
  return result.trimEnd();
}

function finalClean(title: string, references: TitleReference[]): string {
  let cleaned = (/^are\b/iu.test(title) ? title : title.replace(/\?$/u, ""))
    .replace(/^[\s:;,.!?\-–—]+/u, "")
    .replace(/[\s:;,.!。！？\-–—]+$/u, "")
    .replace(/\b([\p{L}\p{N}_-]+)(?:\s+\1\b)+/giu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return "";
  // Deduplicate reference labels at prose boundaries, never inside identifiers.
  const seen = new Set<string>();
  cleaned = cleaned.replace(
    /(?:\s+and\s+|,\s*|(^|\s)([\p{L}\p{N}_-]+)\s+)?\uE000(\d+)\uE001/gu,
    (
      match,
      space: string | undefined,
      word: string | undefined,
      index: string,
    ) => {
      const reference = references[Number(index)];
      const identity = reference?.identity ?? index;
      if (seen.has(identity) && /^(?:\s+and\s+|,)/u.test(match)) return "";
      seen.add(identity);
      return word?.toLowerCase() ===
        reference?.display.split(/\s/u)[0]?.toLowerCase()
        ? (space ?? "") + placeholder(Number(index))
        : match;
    },
  );
  const distinct = new Set(
    [...cleaned.matchAll(PLACEHOLDER)].map(
      (match) => references[Number(match[1])]?.identity,
    ),
  );
  if (distinct.size > 3) {
    const kept = new Set<string>();
    for (const match of cleaned.matchAll(PLACEHOLDER)) {
      kept.add(references[Number(match[1])]?.identity ?? match[0]);
      if (kept.size === 2) {
        references.push({
          display: `and ${distinct.size - 2} more`,
          identity: "summary",
        });
        cleaned = `${cleaned.slice(0, (match.index ?? 0) + match[0].length)} ${placeholder(references.length - 1)}`;
        break;
      }
    }
  }
  const labels: string[] = [];
  const render = (value: string): string =>
    value.replace(
      PLACEHOLDER,
      (_match, index: string) => references[Number(index)]?.display ?? "",
    );
  for (const match of cleaned.matchAll(PLACEHOLDER)) {
    const label = references[Number(match[1])]?.label;
    if (label) labels.push(label);
  }
  // Drop trailing description before truncating the relationship or identity.
  if (codePoints(render(cleaned)) > MAX_TITLE_CODE_POINTS) {
    const matches = [...cleaned.matchAll(PLACEHOLDER)];
    const last = matches.at(-1);
    if (last?.index !== undefined)
      cleaned = cleaned.slice(0, last.index + last[0].length);
  }
  // Reserve space for every identifier; cut only prose on grapheme boundaries.
  const pieces = cleaned.split(/(\uE000\d+\uE001)/u);
  const referenceSize = pieces
    .filter((piece) => /^\uE000/u.test(piece))
    .reduce((sum, piece) => sum + codePoints(render(piece)), 0);
  let proseBudget = Math.max(0, MAX_TITLE_CODE_POINTS - referenceSize);
  let result = "";
  for (const piece of pieces) {
    const display = render(piece);
    if (/^\uE000/u.test(piece)) {
      // An exceptionally long identifier cannot be shortened without changing its identity.
      if (codePoints(result + display) <= MAX_TITLE_CODE_POINTS)
        result += display;
      continue;
    }
    if (codePoints(display) <= proseBudget) {
      result += display;
      proseBudget -= codePoints(display);
    } else if (proseBudget > 0) {
      const cut = graphemeCut(display, proseBudget);
      const boundary = cut.lastIndexOf(" ");
      const shortened =
        boundary > proseBudget / 2 ? cut.slice(0, boundary) : cut;
      const spacer = /\s$/u.test(display) && shortened ? " " : "";
      result +=
        graphemeCut(shortened, Math.max(0, proseBudget - spacer.length)) +
        spacer;
      proseBudget = 0;
    }
  }
  const description = labels.length ? `: ${labels.join("; ")}` : "";
  if (codePoints(result + description) <= SOFT_TITLE_CODE_POINTS)
    result += description;
  result = result.replace(/[\s:;,.!。！？\-–—]+$/u, "").trim();
  // Locators and path identifiers keep their source case; resource labels capitalize at the start.
  return /^\uE000/u.test(cleaned)
    ? result.replace(/^(issue|commit)\b/u, (word) => capitalizeSafely(word))
    : capitalizeSafely(result);
}

function hasFileReference(text: string): boolean {
  return fileReferencePattern().test(text);
}

function hasUrlReference(text: string): boolean {
  return /https?:\/\/\S+|www\.\S+/iu.test(text);
}

function isGreetingOnly(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return /^(?:hi|hello|hey|hiya|greetings|yo|good\s+(?:morning|afternoon|evening))(?:\s+(?:there|nerve|everyone|team|all))?$/u.test(
    normalized,
  );
}

function fallbackTitle(text: string): string {
  if (isGreetingOnly(text)) return GENERAL_CHAT_TITLE;
  if (/!\[[^\]]*\]\(/u.test(text)) return IMAGE_REVIEW_TITLE;
  if (hasUrlReference(text)) return LINK_REVIEW_TITLE;
  if (hasImageReference(text)) return IMAGE_REVIEW_TITLE;
  if (hasFileReference(text)) return FILE_REVIEW_TITLE;
  return DEFAULT_CONVERSATION_TITLE;
}

export function deriveConversationTitle(text: string): string {
  // Cap every downstream scan, including malformed/unclosed code fences.
  text = text.slice(0, MAX_INPUT_LENGTH).replace(/[\uE000\uE001\uE002]/gu, "");
  if (isGreetingOnly(text)) return GENERAL_CHAT_TITLE;
  const protectedPrompt = protectReferences(text);
  if (
    !protectedPrompt.text
      .replace(PLACEHOLDER, "")
      .replace(/[^\p{L}\p{N}]/gu, "") &&
    (hasImageReference(text) || /!\[[^\]]*\]\(/u.test(text))
  )
    return IMAGE_REVIEW_TITLE;
  const entities = collectExplicitEntities(protectedPrompt.text);
  const candidates = candidateFragments(protectedPrompt.text, entities);
  const imageIndex = protectedPrompt.references.findIndex(
    (reference) => reference.identity === "image",
  );
  let best: TitleCandidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (imageIndex >= 0 && candidate.text.trim() === placeholder(imageIndex))
      continue;
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const bestText =
    best && imageIndex >= 0 && !best.text.includes(placeholder(imageIndex))
      ? `${best.text} ${placeholder(imageIndex)}`
      : best?.text;
  return (
    (bestText && finalClean(bestText, protectedPrompt.references)) ||
    fallbackTitle(text)
  );
}
