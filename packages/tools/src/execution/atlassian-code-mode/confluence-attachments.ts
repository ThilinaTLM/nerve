import { extname } from "node:path";
import { jsonObject } from "../atlassian/http.js";
import {
  confluenceDownload,
  confluenceRequest,
  pathSegment,
} from "../confluence/client.js";
import { valuesFromConfluenceList } from "../confluence/format.js";
import {
  freshArtifactName,
  MAX_FILE_BYTES,
  writeArtifact,
} from "./artifacts.js";
import { codedError } from "./errors.js";
import { nonEmptyString } from "./sdk-args.js";
import { defineMethod, type SdkMethod } from "./sdk-types.js";

type Target = { id: string } | { page: string; filename: string };

type Found = { downloadLink?: unknown; title?: unknown };

export const confluenceAttachmentMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "attachments.download",
    risk: "read",
    options: ["id", "page", "filename"],
    signature:
      "/** By attachment id, or by page id and exact filename. Max 20 MB. */ download(options: { id: string } | { page: string; filename: string }): Promise<FileHandle>",
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
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error(
          `Attachment is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
        );
      }
      const title =
        typeof found.title === "string" ? found.title : "attachment";
      const extension = extname(title);
      const stem = title
        .slice(0, title.length - extension.length)
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^[._-]+/, "");
      const name = await freshArtifactName(
        env,
        stem || "attachment",
        extension.replace(/[^A-Za-z0-9.]/g, ""),
      );
      return await writeArtifact(env, name, bytes);
    },
  }),
];
