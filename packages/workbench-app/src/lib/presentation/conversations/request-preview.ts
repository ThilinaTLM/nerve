import type { PreviewToolDefinition } from "@nervekit/contracts/core";

/** The part of the next request a preview pane shows. */
export type RequestPreviewSection = "system-prompt" | "tools";

/**
 * Renders tool definitions as one Markdown document: a heading per tool, its
 * description as the model reads it, then the parameter schema as JSON.
 */
export function toolDefinitionsMarkdown(
  tools: readonly PreviewToolDefinition[],
): string {
  if (tools.length === 0) return "No tools are available for the next request.";
  return tools
    .map(
      (tool) =>
        `# ${tool.name}\n\n${tool.description.trim()}\n\n\`\`\`json\n${JSON.stringify(tool.parameters, null, 2)}\n\`\`\`\n`,
    )
    .join("\n");
}
