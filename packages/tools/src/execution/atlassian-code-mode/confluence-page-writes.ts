import { jsonObject } from "../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "../confluence/client.js";
import { pageWebUrl } from "../confluence/format.js";
import { lintStoragePage } from "../confluence/page-lint.js";
import { fetchPageCurrent } from "../confluence/page-resolution.js";
import { StorageXmlError } from "../confluence/storage-xml.js";
import { resolveSpace } from "./confluence-spaces.js";
import {
  type AttachmentSpec,
  attachmentReadAuthorizations,
  attachmentUploadAuthorizations,
  loadAttachments,
  type LoadedAttachment,
  parseAttachmentSpec,
  type UploadedAttachment,
  uploadAttachment as uploadFile,
} from "./attachments.js";
import { removedElements } from "./confluence-lossy.js";
import { partialWriteFailure } from "./confluence-partial-write.js";
import { codedError } from "./errors.js";
import { nonEmptyString, optionalText } from "./sdk-args.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";

export type BodyFormat = "markdown" | "storage";

export function commentFormat(value: unknown): BodyFormat {
  if (value === undefined) return "markdown";
  if (value === "markdown" || value === "storage") return value;
  throw new Error('format must be "markdown" or "storage".');
}

/** Page bodies are storage XHTML; anything else is rejected with the way to compose it. */
export function storageBodyOption(body: string): string {
  if (!body.trimStart().startsWith("<")) {
    throw new Error(
      "Page bodies are storage XHTML. Compose with storage.*: storage.markdown(md) for prose, storage.panel/table/status/jiraIssues/layout for structure.",
    );
  }
  return body;
}

/** Uploads one file and lists it in the run's created entities. */
export async function uploadAttachment(
  env: SdkEnvironment,
  pageId: string,
  file: LoadedAttachment,
  comment?: string,
): Promise<UploadedAttachment> {
  const uploaded = await uploadFile(env, pageId, file, comment);
  env.report.created.push(`attachment ${uploaded.id} on page ${pageId}`);
  return uploaded;
}

export function attachmentSpecs(value: unknown): AttachmentSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      "attachments must be an array of file handles or { file, filename? }.",
    );
  }
  return value.map(parseAttachmentSpec);
}

/** Converts to storage, lints, and turns malformed XML into a precise rejection (before any HTTP). */
export function finalizeBody(
  body: string,
  title: string,
  toc: boolean,
  attachments: LoadedAttachment[],
) {
  const images = new Map<string, { width: number; height: number }>();
  for (const file of attachments) {
    if (file.width && file.height) {
      images.set(file.filename, { width: file.width, height: file.height });
    }
  }
  try {
    return lintStoragePage(body, { title, toc, images });
  } catch (error) {
    if (error instanceof StorageXmlError) {
      throw new Error(
        `Page body is not well-formed storage XHTML: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function referencedAttachments(storage: string): string[] {
  return [
    ...storage.matchAll(/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/g),
  ].map((m) => m[1]);
}

export function pageUrl(
  connection: ConfluenceConnection,
  page: Record<string, unknown>,
) {
  return (
    pageWebUrl(connection.siteUrl, page) ??
    `${connection.siteUrl}/wiki/pages/viewpage.action?pageId=${String(page.id ?? "")}`
  );
}

export function compactPage(
  connection: ConfluenceConnection,
  page: Record<string, unknown>,
  fallback: { title?: string; version?: number } = {},
) {
  const version = page.version as { number?: unknown } | undefined;
  return {
    id: String(page.id ?? ""),
    title:
      typeof page.title === "string" ? page.title : (fallback.title ?? null),
    url: pageUrl(connection, page),
    version:
      typeof version?.number === "number"
        ? version.number
        : (fallback.version ?? null),
  };
}

export function versionOption(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("version must be the page version number you read.");
  }
  return value;
}

export function pageBodyOption(options: Record<string, unknown>) {
  const body = typeof options.body === "string" ? options.body : undefined;
  return body;
}

/** `pages.create` and `pages.update`: storage bodies, linted, with attachments. */
export const confluencePageWriteMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "pages.create",
    risk: "write",
    options: ["space", "title", "parent", "body", "toc", "attachments"],
    signature:
      "/** body is storage XHTML from storage.*, linted on write. Pass attachments for images the body references. */ create(options: { space?: string; title: string; parent?: string; body: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>",
    parse: (options) => {
      const body = pageBodyOption(options) ?? "";
      if (!body.trim()) throw new Error("body must be a non-empty string.");
      storageBodyOption(body);
      return {
        space: optionalText(options.space),
        title: nonEmptyString(options.title, "title"),
        parent:
          options.parent === undefined
            ? undefined
            : nonEmptyString(options.parent, "parent"),
        body,
        toc: options.toc !== false,
        attachments: attachmentSpecs(options.attachments),
      };
    },
    authorize: ({ space, title, parent, body }) => ({
      toolName: "confluence_create_page",
      args: {
        ...(space ? { space_key: space } : {}),
        title,
        ...(parent ? { parent_id: parent } : {}),
        body,
      },
      summary: `${space ?? "default space"}/${title}`,
    }),
    authorizeAlso: ({ attachments }, env) => [
      ...attachmentUploadAuthorizations("(new page)", attachments),
      ...attachmentReadAuthorizations(attachments, env),
    ],
    resource: ({ space }) => `space ${space ?? "(default)"}`,
    async run({ space, title, parent, body, toc, attachments }, env) {
      const connection = await env.confluence();
      // Read, validate and size attachments first so bad input fails before the page exists.
      const loaded = await loadAttachments(attachments, env);
      const page = finalizeBody(body, title, toc, loaded);
      const { spaceId } = await resolveSpace(env, space);
      const created = await confluenceRequest(connection, {
        parse: jsonObject,
        method: "POST",
        path: "/pages",
        body: {
          spaceId,
          title,
          ...(parent ? { parentId: parent } : {}),
          status: "current",
          body: { representation: "storage", value: page.storage },
        },
        signal: env.context.signal,
      });
      const result = compactPage(connection, created, { title, version: 1 });
      const uploaded: UploadedAttachment[] = [];
      let version = result.version;
      try {
        for (const [index, file] of loaded.entries()) {
          uploaded.push(
            await uploadAttachment(
              env,
              result.id,
              file,
              attachments[index].comment,
            ),
          );
        }
        if (uploaded.length > 0 && page.storage.includes("ri:attachment")) {
          // Save once more now that the attachments exist so image references resolve (bumps the version).
          const updated = await confluenceRequest(connection, {
            parse: jsonObject,
            method: "PUT",
            path: `/pages/${pathSegment(result.id)}`,
            body: {
              id: result.id,
              status: "current",
              title,
              ...(parent ? { parentId: parent } : {}),
              body: { representation: "storage", value: page.storage },
              version: {
                number: (version ?? 1) + 1,
                message: "Attach images",
              },
            },
            signal: env.context.signal,
          });
          version =
            (updated.version as { number?: number } | undefined)?.number ??
            (version ?? 1) + 1;
        }
      } catch (error) {
        const stored = uploaded.map((file) => file.filename);
        throw partialWriteFailure(
          error,
          `page ${result.id} (${result.url}) was already created with its body; ${
            stored.length > 0
              ? `uploaded: ${stored.join(", ")}; the remaining attachments`
              : "its attachments"
          } and image references are missing. Fix that page with confluence.pages.update / attachments.upload; do not create it again`,
        );
      }
      const missing = referencedAttachments(page.storage).filter(
        (name) => !uploaded.some((u) => u.filename === name),
      );
      const warnings = [
        ...page.warnings,
        ...missing.map(
          (name) =>
            `Body references attachment "${name}" that was not attached; pass it in attachments.`,
        ),
      ];
      env.report.pages.push({
        action: "created",
        id: result.id,
        title: result.title ?? title,
        version,
        fixes: page.fixes,
        warnings,
      });
      return {
        ...result,
        version,
        fixes: page.fixes,
        warnings,
        ...(uploaded.length ? { attachments: uploaded } : {}),
      };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.update",
    risk: "write",
    options: [
      "id",
      "version",
      "title",
      "body",
      "allowRemoving",
      "message",
      "toc",
      "attachments",
    ],
    signature:
      '/** Replaces the whole body (read body: "storage" first to edit); omitted title/body are kept. Dropping existing macros/layouts/images/mentions throws unless allowRemoving. Pass the version you read; a newer page throws CONFLICT. */ update(options: { id: string; version?: number; title?: string; body?: string; allowRemoving?: boolean; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>',
    parse: (options) => {
      const body = pageBodyOption(options);
      const title = optionalText(options.title);
      if (body === undefined && !title) {
        throw new Error("Provide a title and/or body to update.");
      }
      if (body !== undefined) storageBodyOption(body);
      return {
        id: nonEmptyString(options.id, "id"),
        version: versionOption(options.version),
        title,
        body,
        allowRemoving: options.allowRemoving === true,
        message: optionalText(options.message),
        toc: options.toc !== false,
        attachments: attachmentSpecs(options.attachments),
      };
    },
    authorize: ({ id, title, body, message }) => ({
      toolName: "confluence_update_page",
      args: {
        page_id: id,
        ...(title ? { title } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(message ? { version_message: message } : {}),
      },
      summary: id,
    }),
    authorizeAlso: ({ id, attachments }, env) => [
      ...attachmentUploadAuthorizations(id, attachments),
      ...attachmentReadAuthorizations(attachments, env),
    ],
    resource: ({ id }) => `page ${id}`,
    async run(
      { id, version, title, body, allowRemoving, message, toc, attachments },
      env,
    ) {
      const connection = await env.confluence();
      const loaded = await loadAttachments(attachments, env);
      const current = await fetchPageCurrent(
        connection,
        id,
        env.context.signal,
      );
      const currentVersion = (
        current.version as { number?: unknown } | undefined
      )?.number;
      if (typeof currentVersion !== "number") {
        throw new Error(
          `Could not determine current version of Confluence page ${id}.`,
        );
      }
      if (version !== undefined && version !== currentVersion) {
        throw codedError(
          "CONFLICT",
          `page ${id} is at v${currentVersion}, you read v${version}; re-read with body: "storage" and reapply`,
        );
      }
      const currentBody = (
        current.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const nextTitle =
        title ?? (typeof current.title === "string" ? current.title : id);
      const page =
        body !== undefined
          ? finalizeBody(body, nextTitle, toc, loaded)
          : {
              storage: typeof currentBody === "string" ? currentBody : "",
              fixes: [],
              warnings: [],
            };
      if (body !== undefined && !allowRemoving) {
        const removed = removedElements(
          typeof currentBody === "string" ? currentBody : "",
          page.storage,
        );
        if (removed) {
          throw new Error(
            `update would remove ${removed}. Edit the storage body (pages.get({ id, body: "storage" })) or pass allowRemoving: true.`,
          );
        }
      }
      const uploaded: UploadedAttachment[] = [];
      let updated;
      try {
        for (const [index, file] of loaded.entries()) {
          uploaded.push(
            await uploadAttachment(env, id, file, attachments[index].comment),
          );
        }
        updated = await confluenceRequest(connection, {
          parse: jsonObject,
          method: "PUT",
          path: `/pages/${pathSegment(id)}`,
          body: {
            id,
            status: "current",
            title: nextTitle,
            ...(current.parentId ? { parentId: current.parentId } : {}),
            body: { representation: "storage", value: page.storage },
            version: {
              number: currentVersion + 1,
              ...(message ? { message } : {}),
            },
          },
          signal: env.context.signal,
        });
      } catch (error) {
        if (uploaded.length === 0) throw error;
        throw partialWriteFailure(
          error,
          `page ${id} was not saved, but these attachments were already uploaded: ${uploaded.map((file) => file.filename).join(", ")}`,
        );
      }
      const result = compactPage(
        connection,
        { ...updated, id },
        { title: nextTitle, version: currentVersion + 1 },
      );
      env.report.pages.push({
        action: "updated",
        id,
        title: result.title ?? nextTitle,
        version: result.version,
        fixes: page.fixes,
        warnings: page.warnings,
      });
      return {
        ...result,
        fixes: page.fixes,
        warnings: page.warnings,
        ...(uploaded.length ? { attachments: uploaded } : {}),
      };
    },
  }),
];
