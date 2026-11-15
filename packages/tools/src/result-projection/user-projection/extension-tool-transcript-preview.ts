import { extensionToolResultDetailsSchema } from "@nervekit/contracts/extensions";
import { firstLines } from "./transcript-text-preview.js";

/** Items kept per list or table section (web search returns at most 20). */
export const EXTENSION_PREVIEW_ITEMS = 20;
/** Longest string kept inside a section value (a link title, snippet or cell). */
const EXTENSION_PREVIEW_VALUE_CHARS = 300;

type ExtensionToolTranscriptPreview = {
  resultPreview: Record<string, unknown>;
  hidden: number;
  noun: string;
  direction: "head";
};

/** Strings shortened, lists cut to the kept item count; counts the dropped items. */
function boundValue(value: unknown, hidden: { items: number }): unknown {
  if (typeof value === "string") {
    return value.length > EXTENSION_PREVIEW_VALUE_CHARS
      ? `${value.slice(0, EXTENSION_PREVIEW_VALUE_CHARS - 1)}…`
      : value;
  }
  if (Array.isArray(value)) {
    hidden.items += Math.max(0, value.length - EXTENSION_PREVIEW_ITEMS);
    return value
      .slice(0, EXTENSION_PREVIEW_ITEMS)
      .map((item) => boundValue(item, hidden));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        boundValue(nested, hidden),
      ]),
    );
  }
  return value;
}

/**
 * The preview of an extension direct tool's result: what its card renders
 * (`details.sections`, `details.artifacts`) with list items and their strings
 * bounded, so the generic depth and key cuts do not blank out link or table
 * fields. Undefined when the result is not an extension tool result.
 */
export function buildExtensionToolTranscriptPreview(
  result: Record<string, unknown>,
): ExtensionToolTranscriptPreview | undefined {
  const parsed = extensionToolResultDetailsSchema.safeParse(result.details);
  if (!parsed.success) return undefined;
  const details = parsed.data;
  const hidden = { items: 0 };
  const sections = details.sections.map((section) => ({
    ...section,
    value: boundValue(section.value, hidden),
  }));
  const content = firstLines(
    typeof result.content === "string" ? result.content : undefined,
  );
  return {
    resultPreview: {
      details: {
        extension: details.extension,
        tool: details.tool,
        sections,
        ...(Array.isArray(details.artifacts)
          ? { artifacts: details.artifacts }
          : {}),
      },
      ...(content.value === undefined ? {} : { content: content.value }),
    },
    hidden: hidden.items > 0 ? hidden.items : content.hidden,
    noun:
      hidden.items > 0 ? "items" : content.hiddenLines ? "lines" : "characters",
    direction: "head",
  };
}
