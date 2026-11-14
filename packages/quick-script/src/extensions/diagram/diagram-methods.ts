import { krokiToolSettingsSchema } from "@nervekit/contracts/settings";
import { krokiDiagramTypeSchema } from "@nervekit/contracts/tools";
import { fetchKrokiDiagram } from "./kroki-export.js";
import { withTimeoutSignal } from "@nervekit/tools/execution";
import {
  assertArtifactName,
  freshArtifactName,
  writeArtifact,
} from "../../runtime/files/artifacts.js";
import { nonEmptyString } from "../../runtime/sdk-args.js";
import { defineMethod, type SdkMethod } from "../../runtime/sdk-types.js";

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

export const diagramMethods: SdkMethod[] = [
  defineMethod({
    product: "diagram",
    path: "render",
    risk: "network",
    options: ["type", "source", "name"],
    signature:
      "/** Kroki engine such as mermaid, d2 or plantuml; returns a PNG artifact handle. */ render(options: { type: string; source: string; name?: string }): Promise<FileHandle>",
    parse: (options) => {
      const source = nonEmptyString(options.source, "source");
      if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
        throw new Error(
          `source must not exceed ${MAX_SOURCE_BYTES} UTF-8 bytes.`,
        );
      }
      return {
        type: nonEmptyString(options.type, "type"),
        source,
        name:
          options.name === undefined
            ? undefined
            : assertArtifactName(options.name),
      };
    },
    authorize: ({ type }) => ({ targets: [], summary: type }),
    resource: () => "the Kroki server",
    async run({ type, source, name }, env) {
      if (!env.context.kroki) {
        throw new Error("Kroki is not configured in Settings.");
      }
      const { url } = krokiToolSettingsSchema.parse(env.context.kroki);
      const bytes = await fetchKrokiDiagram({
        url,
        diagramType: krokiDiagramTypeSchema.parse(type),
        source: withMermaidDefaults(type, source),
        outputFormat: "png",
        signal: withTimeoutSignal(env.context.signal, 60_000),
      });
      return await writeArtifact(
        env,
        name ?? (await freshArtifactName(env, "diagram", ".png")),
        bytes,
      );
    },
  }),
];
