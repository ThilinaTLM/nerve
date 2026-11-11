import { extname } from "node:path";
import { jsonObject } from "../../atlassian/http.js";
import {
  confluenceDownload,
  confluenceRequest,
  pathSegment,
} from "../../confluence/client.js";
import { valuesFromConfluenceList } from "../../confluence/format.js";
import {
  freshArtifactName,
  MAX_ATTACHMENT_BYTES,
  artifactNameFor,
  writeArtifact,
} from "../files/artifacts.js";
import { codedError } from "../errors.js";
import { nonEmptyString } from "../sdk-args.js";
import { defineMethod, type SdkMethod } from "../sdk-types.js";

type Target = { id: string } | { page: string; filename: string };

type Found = { downloadLink?: unknown; title?: unknown };

export const confluenceAttachmentMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "attachments.download",
    risk: "network",
    options: ["id", "page", "filename"],
    signature:
      "/** By attachment id, or by page id and exact filename. Max 25 MB. */ download(options: { id: string } | { page: string; filename: string }): Promise<FileHandle>",
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
      toolName: "confluence_get_page",
      args: { page_id: "id" in target ? target.id : target.page },
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
      const bytes = await confluenceDownload(
        connection,
        found.downloadLink,
        env.context.signal,
      );
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Attachment is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is 25 MB. Use confluence_manage_attachment (direct tool).`,
        );
      }
      const title =
        typeof found.title === "string" ? found.title : "attachment";
      const filename = artifactNameFor(title);
      const extension = extname(filename);
      const name = await freshArtifactName(
        env,
        filename.slice(0, filename.length - extension.length),
        extension,
      );
      return await writeArtifact(env, name, bytes);
    },
  }),
];
