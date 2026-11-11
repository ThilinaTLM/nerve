import { krokiToolSettingsSchema } from "@nervekit/contracts/settings";
import { krokiDiagramTypeSchema } from "@nervekit/contracts/tools";
import { fetchKrokiDiagram } from "../kroki/kroki-export.js";
import { withTimeoutSignal } from "../process/abort.js";
import {
  assertArtifactName,
  freshArtifactName,
  writeArtifact,
} from "./artifacts.js";
import { nonEmptyString } from "./sdk-args.js";
import { defineMethod, type SdkMethod } from "./sdk-types.js";

const MAX_SOURCE_BYTES = 128 * 1024;

export const diagramMethods: SdkMethod[] = [
  defineMethod({
    product: "diagram",
    path: "render",
    options: ["type", "source", "name"],
    signature:
      "render({ type, source, name? }): Promise<string>  // PNG saved as an artifact; returns its handle ('artifact:diagram-1.png' unless name is given)",
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
    authorize: ({ type, source }) => ({
      toolName: "kroki_export",
      args: { diagram_type: type, source },
      summary: type,
    }),
    resource: () => "the Kroki server",
    async run({ type, source, name }, env) {
      if (!env.context.kroki) {
        throw new Error("Kroki is not configured in Settings.");
      }
      const { url } = krokiToolSettingsSchema.parse(env.context.kroki);
      const bytes = await fetchKrokiDiagram({
        url,
        diagramType: krokiDiagramTypeSchema.parse(type),
        source,
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
