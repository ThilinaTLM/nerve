import { krokiToolSettingsSchema } from "@nervekit/contracts/settings";
import { krokiDiagramTypeSchema } from "@nervekit/contracts/tools";
import { fetchKrokiDiagram } from "../kroki/kroki-export.js";
import { readImageSize } from "../confluence/image-size.js";
import { withTimeoutSignal } from "../process/abort.js";
import { nonEmptyString, objectArg } from "./sdk-args.js";
import { defineMethod, type SdkMethod } from "./sdk-types.js";

const MAX_SOURCE_BYTES = 128 * 1024;

export const diagramMethods: SdkMethod[] = [
  defineMethod({
    product: "diagram",
    path: "render",
    signature:
      'render({ type, source, format?: "png" }): Promise<{ file, filename, width, height }>  // opaque handle for confluence.attachments.upload / pages.create attachments; then storage.image(filename)',
    parse: ([first]) => {
      const options = objectArg(first);
      const format = options.format ?? "png";
      if (format !== "png") {
        throw new Error(
          'Only format "png" is supported (Confluence does not render SVG reliably).',
        );
      }
      const source = nonEmptyString(options.source, "source");
      if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
        throw new Error(
          `source must not exceed ${MAX_SOURCE_BYTES} UTF-8 bytes.`,
        );
      }
      return {
        type: nonEmptyString(options.type ?? options.diagram_type, "type"),
        source,
      };
    },
    authorize: ({ type, source }) => ({
      toolName: "kroki_export",
      args: { diagram_type: type, source },
      summary: type,
    }),
    async run({ type, source }, env) {
      if (!env.context.kroki)
        throw new Error("Kroki is not configured in Settings.");
      const { url } = krokiToolSettingsSchema.parse(env.context.kroki);
      const diagramType = krokiDiagramTypeSchema.parse(type);
      const bytes = await fetchKrokiDiagram({
        url,
        diagramType,
        source,
        outputFormat: "png",
        signal: withTimeoutSignal(env.context.signal, 60_000),
      });
      const size = readImageSize(bytes, "png");
      const id = `file${env.files.size + 1}`;
      const filename = `diagram-${env.files.size + 1}.png`;
      env.files.set(id, {
        bytes,
        filename,
        mediaType: "image/png",
        ...(size ?? {}),
      });
      // Only the handle crosses into the sandbox, never the bytes.
      return {
        file: id,
        filename,
        width: size?.width ?? null,
        height: size?.height ?? null,
      };
    },
  }),
];
