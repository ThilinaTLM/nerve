import {
  defaultFileDisplayMode,
  isMarkdownPath,
  type FileDisplayMode,
} from "@nervekit/ui-kit/core/utils/file-display";
import { extname } from "../../tools/views/lang.js";
import type { FilePaneViewModel } from "./types.js";

export type ResolvedFilePaneModel = {
  filePath: string;
  markdown: boolean;
  lineStart: number;
  targetLine?: number;
  displayMode: FileDisplayMode;
  language?: string;
  imageSrc?: string;
  textLength: number;
  scrollSignature?: string;
};

function imageDataUrl(view: FilePaneViewModel): string | undefined {
  const file = view.content;
  if (
    file?.type !== "image" ||
    !file.dataBase64 ||
    !file.mimeType ||
    !/^image\/[a-z0-9.+-]+$/i.test(file.mimeType)
  ) {
    return undefined;
  }
  return `data:${file.mimeType};base64,${file.dataBase64}`;
}

export function resolveFilePaneModel(
  view: FilePaneViewModel,
): ResolvedFilePaneModel {
  const file = view.content;
  const filePath = file?.relativePath || view.path;
  const targetLine = view.line ?? file?.targetLine;
  const displayMode =
    view.displayMode ?? (targetLine ? "raw" : defaultFileDisplayMode(filePath));
  const textLength =
    file?.type === "text" && file.text !== undefined ? file.text.length : 0;

  return {
    filePath,
    markdown: isMarkdownPath(filePath),
    lineStart: file?.lineStart ?? 1,
    targetLine,
    displayMode,
    language: extname(filePath),
    imageSrc: imageDataUrl(view),
    textLength,
    scrollSignature:
      file?.type === "text" && targetLine
        ? `${file.path}:${file.lineStart ?? 1}:${targetLine}:${displayMode}:${textLength}`
        : undefined,
  };
}
