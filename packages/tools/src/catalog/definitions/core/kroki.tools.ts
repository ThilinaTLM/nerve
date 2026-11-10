import { Type } from "typebox";
import { executeKrokiExport } from "../../../execution/kroki/kroki-export.js";
import type { ToolDefinition } from "../../contracts.js";

export const krokiToolDefinitions = [
  {
    name: "kroki_export",
    group: "diagramExport",
    baseRisk: "network",
    traits: [],
    executionKind: "local",
    executor: executeKrokiExport,
    label: "Export Diagram",
    description:
      "Render a diagram to SVG/PNG through the configured Kroki server (the source is sent to it). Provide exactly one of `source_path` (preferred, so fixes can be targeted edits) or `source`. Paths are absolute or cwd-relative. Returns the output path.",
    parameters: Type.Object(
      {
        diagram_type: Type.String({
          description: "Kroki engine, e.g. mermaid, d2",
        }),
        source_path: Type.Optional(
          Type.String({
            description: "Max 128 KiB.",
            minLength: 1,
          }),
        ),
        source: Type.Optional(
          Type.String({
            description: "Inline source, max 128 KiB.",
            minLength: 1,
            maxLength: 131_072,
          }),
        ),
        output_path: Type.Optional(
          Type.String({
            description:
              "Output .svg/.png file; overwrites. Default: managed artifact.",
            minLength: 1,
          }),
        ),
        output_format: Type.Optional(
          Type.Enum(["svg", "png"], {
            description: "Default: output_path extension, else svg.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
