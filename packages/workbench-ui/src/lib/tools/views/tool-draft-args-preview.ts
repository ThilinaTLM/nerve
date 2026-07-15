import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";

export type DraftArgsPreview = {
  argsPreview?: string;
  argsPreviewLanguage?: "json";
};

export type DraftArgsPreviewOptions = {
  maxLines: number;
  maxChars: number;
};

function normalizeLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function tailLinePreview(text: string, maxLines: number): string {
  if (text.length === 0) return "";
  const lines = normalizeLines(text).split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(-maxLines).join("\n");
}

function tailChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

function draftPreviewText(
  text: string,
  options: DraftArgsPreviewOptions,
): string | undefined {
  const normalized = normalizeLines(text).trimEnd();
  if (normalized.length === 0) return undefined;
  return tailLinePreview(
    tailChars(normalized, options.maxChars),
    options.maxLines,
  );
}

function formatPartialJsonish(text: string): string {
  let formatted = "";
  let indent = 0;
  let inString = false;
  let escaping = false;

  const appendIndent = () => {
    formatted += "  ".repeat(indent);
  };
  const appendNewline = () => {
    formatted = formatted.trimEnd();
    formatted += "\n";
    appendIndent();
  };

  for (const char of text) {
    if (inString) {
      formatted += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      formatted += char;
      continue;
    }
    if (char === "{" || char === "[") {
      formatted += char;
      indent += 1;
      appendNewline();
      continue;
    }
    if (char === "}" || char === "]") {
      indent = Math.max(0, indent - 1);
      appendNewline();
      formatted += char;
      continue;
    }
    if (char === ",") {
      formatted += char;
      appendNewline();
      continue;
    }
    if (char === ":") {
      formatted += ": ";
      continue;
    }
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      continue;
    }
    formatted += char;
  }

  return formatted.trimEnd();
}

export function draftArgsPreview(
  draft: ConversationLiveToolDraftBlockSnapshot,
  options: DraftArgsPreviewOptions,
): DraftArgsPreview {
  if (draft.args !== undefined) {
    const preview = draftPreviewText(
      JSON.stringify(draft.args, null, 2),
      options,
    );
    return preview ? { argsPreview: preview, argsPreviewLanguage: "json" } : {};
  }

  const argsText = draft.argsText.trim();
  if (!argsText) return {};
  const preview = draftPreviewText(formatPartialJsonish(argsText), options);
  return preview ? { argsPreview: preview, argsPreviewLanguage: "json" } : {};
}
