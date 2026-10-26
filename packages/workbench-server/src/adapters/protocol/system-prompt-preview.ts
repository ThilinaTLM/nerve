import type { PreviewSystemPromptResult } from "@nervekit/contracts/core";

/** Turn preparation also returns executor tools; these are not public preview DTO fields. */
export function publicSystemPromptPreview(
  result: PreviewSystemPromptResult,
): PreviewSystemPromptResult {
  return result.status === "available"
    ? {
        status: result.status,
        systemPrompt: result.systemPrompt,
        resolution: result.resolution,
      }
    : { status: result.status, diagnostics: result.diagnostics };
}
