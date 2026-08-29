const WEB_PREVIEW_COUNT = 10;
const WEB_PREVIEW_MAX_CHARS = 8 * 1024;

type WebToolTranscriptPreview = {
  resultPreview: Record<string, unknown>;
  hidden: number;
  noun: string;
  direction: "head";
  semanticOverflow: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function outputText(result: Record<string, unknown>): string | undefined {
  const content = stringField(result.content);
  if (content !== undefined) return content;
  if (!Array.isArray(result.contentBlocks)) return undefined;
  const text = result.contentBlocks
    .map(record)
    .filter((block) => block.type === "text")
    .map((block) => stringField(block.text))
    .filter((value): value is string => value !== undefined)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function webSearchResultPreview(value: unknown): Record<string, unknown> {
  const result = record(value);
  return {
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
  };
}

export function buildWebSearchTranscriptPreview(
  result: Record<string, unknown>,
): WebToolTranscriptPreview {
  const details = record(result.details);
  const allResults = Array.isArray(details.results) ? details.results : [];
  const results = allResults.slice(0, WEB_PREVIEW_COUNT);
  const hidden = allResults.length - results.length;
  return {
    resultPreview: {
      details: {
        query: details.query,
        answer: details.answer,
        results: results.map(webSearchResultPreview),
        outputLimits: details.outputLimits,
      },
    },
    hidden,
    noun: "results",
    direction: "head",
    semanticOverflow: hidden > 0,
  };
}

export function buildWebFetchTranscriptPreview(
  result: Record<string, unknown>,
): WebToolTranscriptPreview {
  const details = record(result.details);
  const content = headText(outputText(result));
  return {
    resultPreview: {
      details: {
        url: details.url,
        status: details.status,
        contentType: details.contentType,
        size: details.size,
        savedTo: details.savedTo,
        converted: details.converted,
        outputLimits: details.outputLimits,
      },
      content: content.value,
    },
    hidden: content.hidden,
    noun: content.hiddenLines > 0 ? "lines" : "characters",
    direction: "head",
    semanticOverflow: false,
  };
}

function headText(text: string | undefined): {
  value: string | undefined;
  hidden: number;
  hiddenLines: number;
} {
  if (text === undefined)
    return { value: undefined, hidden: 0, hiddenLines: 0 };
  const lineEnd = endAfterFirstLines(text, WEB_PREVIEW_COUNT);
  const charEnd = Math.min(lineEnd, WEB_PREVIEW_MAX_CHARS);
  const hiddenLines = countLinesFrom(text, lineEnd);
  const hiddenChars = Math.max(0, text.length - charEnd);
  return {
    value: text.slice(0, charEnd),
    hidden: hiddenLines > 0 ? hiddenLines : hiddenChars,
    hiddenLines,
  };
}

function endAfterFirstLines(text: string, count: number): number {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    if (lines >= count) return index;
    lines += 1;
  }
  return text.length;
}

function countLinesFrom(text: string, offset: number): number {
  if (offset >= text.length) return 0;
  let start = offset;
  if (text[start] === "\n") start += 1;
  if (start >= text.length) return 0;
  let lines = 1;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
}
