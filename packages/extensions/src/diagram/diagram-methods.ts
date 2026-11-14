import {
  ExtensionError,
  isArtifactName,
  method,
  nonEmptyString,
  parseOptions,
} from "@nervekit/extension-api";
import { fetchKrokiDiagram, KROKI_DIAGRAM_TYPE } from "./kroki-export.js";

export const MAX_SOURCE_BYTES = 128 * 1024;

const PIE_COLORS = [
  "#2563eb",
  "#ea580c",
  "#16a34a",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
];
const PIE_INIT = `%%{init: {"themeVariables": {${PIE_COLORS.map(
  (color, index) => `"pie${index + 1}": "${color}"`,
).join(", ")}, "pieOuterStrokeWidth": "1px"}}}%%\n`;

/**
 * Mermaid's default pie slices are near-white pastels. Pie charts without their
 * own `%%{init` directive or frontmatter get a saturated palette instead.
 */
export function withMermaidDefaults(type: string, source: string): string {
  if (type !== "mermaid" || source.includes("%%{init")) return source;
  const first = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));
  return first && /^pie\b/.test(first) ? PIE_INIT + source : source;
}

export const diagramMethods = {
  render: method({
    risk: "network",
    signature:
      "/** Kroki engine such as mermaid, d2 or plantuml; returns a PNG artifact handle. */ render(options: { type: string; source: string; name?: string }): Promise<FileHandle>",
    parse: (args) => {
      const options = parseOptions("diagram.render", args, {
        options: ["type", "source", "name"],
      });
      const source = nonEmptyString(options.source, "source");
      if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES)
        throw new ExtensionError(
          "BAD_REQUEST",
          `source must not exceed ${MAX_SOURCE_BYTES} UTF-8 bytes.`,
        );
      const type = nonEmptyString(options.type, "type");
      if (!KROKI_DIAGRAM_TYPE.test(type))
        throw new ExtensionError(
          "BAD_REQUEST",
          `type must be a Kroki engine name such as mermaid, d2 or plantuml.`,
        );
      const name = options.name;
      if (
        name !== undefined &&
        !(typeof name === "string" && isArtifactName(name))
      )
        throw new ExtensionError(
          "BAD_REQUEST",
          `Invalid artifact name ${JSON.stringify(name)}: use 1-128 letters, digits, spaces, '.', '_' or '-' (no folders, no leading dot).`,
        );
      return { type, source, name };
    },
    authorize: ({ type }) => ({ targets: [], summary: type }),
    resource: () => "the Kroki server",
    async run(_session, { type, source, name }, ctx) {
      const url = ctx.settings.get<string>("server");
      if (!url)
        throw new ExtensionError(
          "BAD_REQUEST",
          "No Kroki server is configured.",
          {
            fix: "Ask the user to set one in Settings → Extensions → Diagrams.",
          },
        );
      const bytes = await fetchKrokiDiagram(ctx, {
        url,
        diagramType: type,
        source: withMermaidDefaults(type, source),
      });
      const artifact = await ctx.artifacts.write(
        name ?? (await ctx.artifacts.freshName("diagram", ".png")),
        bytes,
        "image/png",
      );
      return artifact.handle;
    },
  }),
};
