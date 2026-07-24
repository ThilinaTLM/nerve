import { isolatedHtmlToMarkdown } from "../common/isolated-html-to-markdown.js";

export async function storageXmlToMarkdown(
  storageXml: string,
  signal?: AbortSignal,
): Promise<string> {
  return await isolatedHtmlToMarkdown(storageXml, {
    mode: "confluence-storage",
    signal,
  });
}
