import {
  defaultFileDisplayMode,
  fileRenderKind,
  type FileDisplayMode,
  type FileRenderKind,
} from "@nervekit/ui-kit/display/file-display";
import { localPathDirectory } from "@nervekit/ui-kit/display/path-links";
import type { FilePaneViewModel } from "./file-pane-contracts.js";

export type ResolvedFilePaneModel = {
  filePath: string;
  linkBasePath: string;
  renderKind?: FileRenderKind;
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
    linkBasePath: localPathDirectory(file?.path ?? view.path),
    renderKind: fileRenderKind(filePath),
    lineStart: file?.lineStart ?? 1,
    targetLine,
    displayMode,
    language: filePath,
    imageSrc: imageDataUrl(view),
    textLength,
    scrollSignature:
      file?.type === "text" && targetLine
        ? `${file.path}:${file.lineStart ?? 1}:${targetLine}:${displayMode}:${textLength}`
        : undefined,
  };
}
