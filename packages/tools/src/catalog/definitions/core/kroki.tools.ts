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
      "Render a diagram to SVG/PNG via the Kroki server configured in Settings (source is sent to it). Prefer source_path so fixes can be targeted edits. Returns the output path.",
    parameters: Type.Object(
      {
        diagram_type: Type.String({
          description: "Kroki engine, e.g. mermaid, plantuml, graphviz, d2",
        }),
        source_path: Type.Optional(
          Type.String({
            description:
              "Diagram source file (max 128 KiB), absolute or cwd-relative. Preferred over source",
            minLength: 1,
          }),
        ),
        source: Type.Optional(
          Type.String({
            description:
              "Inline diagram source (max 128 KiB) when no file exists",
            minLength: 1,
            maxLength: 131_072,
          }),
        ),
        output_path: Type.Optional(
          Type.String({
            description:
              "Output .svg/.png file, absolute or cwd-relative; overwrites. Default: managed artifact",
            minLength: 1,
          }),
        ),
        output_format: Type.Optional(
          Type.Union([Type.Literal("svg"), Type.Literal("png")], {
            description: "Default: output_path extension, else svg",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
