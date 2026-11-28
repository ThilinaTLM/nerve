import type { PreviewSystemPromptResult } from "@nervekit/contracts/core";
import type { ConfigurationPreview } from "@nervekit/conversation-core";

/**
 * Turn preparation returns executor tool definitions; the preview exposes only
 * what the model receives for each tool (as the model turn projects them).
 */
export function publicSystemPromptPreview(
  result: ConfigurationPreview,
): PreviewSystemPromptResult {
  return result.status === "available"
    ? {
        status: result.status,
        systemPrompt: result.systemPrompt,
        tools: structuredClone(
          result.tools.map(({ name, description, parameters }) => ({
            name,
            description,
            // TypeBox schemas are JSON Schema objects; cloning drops their symbol keys.
            parameters: { ...parameters },
          })),
        ),
        resolution: result.resolution,
      }
    : { status: result.status, diagnostics: result.diagnostics };
}
