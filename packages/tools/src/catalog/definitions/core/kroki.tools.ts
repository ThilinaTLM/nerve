import { Type } from "typebox";
import { executeKrokiExport } from "../../../execution/kroki/kroki-export.js";
import type { ToolDefinition } from "../../contracts.js";

export const krokiToolDefinitions = [
  {
    name: "kroki_export",
    group: "kroki",
    baseRisk: "network",
    traits: [],
    executionKind: "local",
    executor: executeKrokiExport,
    label: "Export Diagram",
    description:
      "Export diagram source as SVG or PNG using the Kroki server configured in Settings. Saves a managed artifact and returns its path. Sends diagram source to that server; supported engines/formats depend on its deployment.",
    parameters: Type.Object(
      {
        diagram_type: Type.String({
          description:
            "Kroki engine, e.g. mermaid, plantuml, graphviz, d2, c4plantuml, or structurizr",
          pattern: "^[a-z][a-z0-9-]{0,63}$",
        }),
        source: Type.String({
          description: "Complete diagram source (maximum 128 KiB UTF-8)",
          minLength: 1,
          maxLength: 131_072,
        }),
        output_format: Type.Optional(
          Type.Union([Type.Literal("svg"), Type.Literal("png")], {
            description: "Output format (default: svg)",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
