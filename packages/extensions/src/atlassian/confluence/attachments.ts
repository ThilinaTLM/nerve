import { extname } from "node:path";
import { jsonObject } from "../shared/http.js";
import { confluenceDownloadToArtifact, confluenceRequest } from "./client.js";
import { pathSegment } from "../jira/client.js";
import { valuesFromConfluenceList } from "./format.js";
import { artifactNameFor } from "../shared/files.js";
import { codedError } from "../shared/errors.js";
import { nonEmptyString } from "../shared/args.js";
import { confluenceAttachment, confluencePage } from "../shared/targets.js";
import { defineMethod, type PathedMethod } from "../shared/define-method.js";
import type { ConfluenceSession } from "./session.js";

type Target = { id: string } | { page: string; filename: string };

type Found = { downloadLink?: unknown; title?: unknown };

export const confluenceAttachmentMethods: PathedMethod<ConfluenceSession>[] = [
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
    async run(target, session) {
      const connection = session.connection;
      let found: Found | undefined;
      if ("id" in target) {
        found = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/attachments/${pathSegment(target.id)}`,
        });
      } else {
        const response = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/pages/${pathSegment(target.page)}/attachments`,
          query: { limit: 250 },
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
      const title =
        typeof found.title === "string" ? found.title : "attachment";
      const filename = artifactNameFor(title);
      const extension = extname(filename);
      const name = await session.ctx.artifacts.freshName(
        filename.slice(0, filename.length - extension.length),
        extension,
      );
      return (
        await confluenceDownloadToArtifact(connection, found.downloadLink, {
          name,
        })
      ).handle;
    },
  }),
];
