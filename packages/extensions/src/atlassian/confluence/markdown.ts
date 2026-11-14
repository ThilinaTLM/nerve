import { isolatedHtmlToMarkdown } from "@nervekit/tools/execution";

export async function storageXmlToMarkdown(
  storageXml: string,
  signal?: AbortSignal,
): Promise<string> {
  return await isolatedHtmlToMarkdown(storageXml, {
    mode: "confluence-storage",
    signal,
  });
}
