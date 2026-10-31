/** Reserved for automatically derived titles. Raw prompts must strip this token. */
export const CONVERSATION_TITLE_IMAGE_MARKER = "\uE002";
export type ConversationTitleSegment =
  | { type: "text"; text: string }
  | { type: "image" };

export function splitConversationTitle(
  title: string,
): ConversationTitleSegment[] {
  return title
    .split(CONVERSATION_TITLE_IMAGE_MARKER)
    .flatMap((text, index) => [
      ...(index ? [{ type: "image" as const }] : []),
      ...(text ? [{ type: "text" as const, text }] : []),
    ]);
}

export function conversationTitleToPlainText(title: string): string {
  return title.replaceAll(CONVERSATION_TITLE_IMAGE_MARKER, "(image)");
}

type ImageSpan = [start: number, end: number];

function replaceSpans(
  text: string,
  replacement: string,
  spans: ImageSpan[],
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    parts.push(text.slice(cursor, start));
    // Keep String.replace's replacement-string semantics (there are no captures).
    parts.push(
      replacement.replace(/\$([$&`'])/gu, (_, token: string) => {
        switch (token) {
          case "$":
            return "$";
          case "&":
            return text.slice(start, end);
          case "`":
            return text.slice(0, start);
          default:
            return text.slice(end);
        }
      }),
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function markdownImages(text: string): ImageSpan[] {
  const spans: ImageSpan[] = [];
  let start = -1;
  let destination = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\n") {
      start = -1;
      destination = false;
    } else if (start < 0) {
      if (char === "!" && text[index + 1] === "[") {
        start = index++;
      }
    } else if (!destination && char === "]") {
      if (text[index + 1] === "(") {
        destination = true;
        index++;
      } else {
        start = -1;
      }
    } else if (destination && char === ")") {
      spans.push([start, index + 1]);
      start = -1;
      destination = false;
    }
    // Nested openers cannot succeed before this candidate: they share its
    // first closing bracket/parenthesis or its terminating newline.
  }
  return spans;
}

function isPathBoundary(char: string, suffix = false): boolean {
  return (
    /\s/u.test(char) ||
    "<>`\"'(),;!".includes(char) ||
    (!suffix && char === "?")
  );
}

function imageExtensionEnd(text: string, dot: number): number {
  // Bounded lookahead, including the long-s folding of the former /iu regex.
  const extension = text
    .slice(dot + 1, dot + 5)
    .toLowerCase()
    .replaceAll("ſ", "s");
  for (const candidate of [
    "png",
    "jpeg",
    "jpg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "avif",
    "heic",
    "tiff",
    "tif",
  ]) {
    if (extension.startsWith(candidate)) return dot + 1 + candidate.length;
  }
  return -1;
}

function imagePaths(text: string): ImageSpan[] {
  const spans: ImageSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (isPathBoundary(text[index])) {
      index++;
      continue;
    }
    const start = index;
    let end = -1;
    // The old greedy path body chooses the rightmost qualifying extension.
    // Drive, @, and relative-path prefixes are already part of this token.
    while (index < text.length && !isPathBoundary(text[index])) {
      if (text[index] === ".") {
        const candidate = imageExtensionEnd(text, index);
        if (candidate >= 0) end = candidate;
      }
      index++;
    }
    if (end < 0) continue;
    if (text[end] === "?" || text[end] === "#") {
      index = end + 1;
      while (index < text.length && !isPathBoundary(text[index], true)) index++;
      end = index;
    }
    spans.push([start, end]);
  }
  return spans;
}

/** Recognizes image references without reading files or resolving URLs. */
export function replaceConversationImages(
  text: string,
  replacement: string,
): string {
  const withoutMarkdown = replaceSpans(text, replacement, markdownImages(text));
  return replaceSpans(
    withoutMarkdown,
    replacement,
    imagePaths(withoutMarkdown),
  );
}
