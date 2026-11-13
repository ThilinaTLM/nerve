import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { jsonObject } from "@nervekit/tools/integrations";
import {
  confluenceDownloadToFile,
  confluenceRequest,
  pathSegment,
} from "@nervekit/tools/integrations";
import { valuesFromConfluenceList } from "@nervekit/tools/integrations";
import {
  artifactNameFor,
  artifactTempPath,
  commitArtifact,
  freshArtifactName,
  MAX_ATTACHMENT_BYTES,
} from "../../../runtime/files/artifacts.js";
import { codedError } from "../../../runtime/errors.js";
import { nonEmptyString } from "../../../runtime/sdk-args.js";
import { defineMethod, type SdkMethod } from "../../../runtime/sdk-types.js";
import { confluenceAttachment, confluencePage } from "../shared/targets.js";

type Target = { id: string } | { page: string; filename: string };

type Found = { downloadLink?: unknown; title?: unknown };

export const confluenceAttachmentMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "attachments.download",
    risk: "network",
    options: ["id", "page", "filename"],
    signature:
      "/** By attachment id, or by page id and exact filename. Max 100 MB. */ download(options: { id: string } | { page: string; filename: string }): Promise<FileHandle>",
    parse: (options): Target => {
      if (options.id !== undefined) {
        return { id: nonEmptyString(options.id, "id") };
      }
      if (options.page === undefined) {
        throw new Error("Provide id, or page and filename.");
      }
      return {
        page: nonEmptyString(options.page, "page"),
        filename: nonEmptyString(options.filename, "filename"),
      };
    },
    authorize: (target) => ({
      targets: [
        "id" in target
          ? confluenceAttachment(target.id)
          : confluencePage(target.page),
      ],
      summary:
        "id" in target
          ? `attachment ${target.id}`
          : `${target.page}/${target.filename}`,
    }),
    resource: (target) =>
      "id" in target ? `attachment ${target.id}` : `page ${target.page}`,
    async run(target, env) {
      const connection = await env.confluence();
      let found: Found | undefined;
      if ("id" in target) {
        found = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/attachments/${pathSegment(target.id)}`,
          signal: env.context.signal,
        });
      } else {
        const response = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/pages/${pathSegment(target.page)}/attachments`,
          query: { limit: 250 },
          signal: env.context.signal,
        });
        const all = valuesFromConfluenceList(response) as Found[];
        found = all.find((item) => item.title === target.filename);
        if (!found) {
          const names = all.map((item) => String(item.title)).slice(0, 25);
          throw codedError(
            "NOT_FOUND",
            `Page ${target.page} has no attachment "${target.filename}". Attachments: ${names.join(", ") || "(none)"}.`,
          );
        }
      }
      if (typeof found.downloadLink !== "string") {
        throw codedError("NOT_FOUND", "Attachment has no download link.");
      }
      const tempPath = await artifactTempPath(env);
      await confluenceDownloadToFile(connection, found.downloadLink, {
        destination: tempPath,
        maxBytes: MAX_ATTACHMENT_BYTES,
        signal: env.context.signal,
      }).catch((error: unknown) => {
        if (
          error instanceof ToolExecutionError &&
          error.code === "CONFLUENCE_ATTACHMENT_TOO_LARGE"
        ) {
          throw new Error(
            `Attachment is ${(Number(error.details?.bytes ?? 0) / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`,
          );
        }
        throw error;
      });
      const title =
        typeof found.title === "string" ? found.title : "attachment";
      const filename = artifactNameFor(title);
      const extension = extname(filename);
      const name = await freshArtifactName(
        env,
        filename.slice(0, filename.length - extension.length),
        extension,
      ).catch(async (error: unknown) => {
        await rm(tempPath, { force: true });
        throw error;
      });
      return await commitArtifact(env, tempPath, name);
    },
  }),
];
