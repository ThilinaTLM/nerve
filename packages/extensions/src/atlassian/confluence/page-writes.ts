import type { ExtensionContext } from "@nervekit/extension-api";
import { jsonObject } from "../shared/http.js";
import {
  type ConfluenceConnection,
  confluenceDownload,
  confluenceRequest,
} from "./client.js";
import { pathSegment } from "../jira/client.js";
import { pageWebUrl, valuesFromConfluenceList } from "./format.js";
import { lintStoragePage } from "./page-lint.js";
import { fetchPageCurrent } from "./page-resolution.js";
import { StorageXmlError } from "./storage-xml.js";
import { resolveSpace } from "./spaces.js";
import {
  type AttachmentSpec,
  attachmentReadAuthorizations,
  loadAttachments,
  type LoadedAttachment,
  parseAttachmentSpec,
  type UploadedAttachment,
  uploadAttachment as uploadFile,
} from "../shared/attachments.js";
import { removedElements } from "./lossy.js";
import { partialWriteFailure } from "./partial-write.js";
import {
  artifactNameFor,
  MAX_ATTACHMENT_BYTES,
  mediaTypeFor,
} from "../shared/files.js";
import { imageSize } from "../shared/image-size.js";
import { codedError } from "../shared/errors.js";
import { nonEmptyString, optionalText } from "../shared/args.js";
import { confluencePage, confluenceSpace } from "../shared/targets.js";
import { defineMethod, type PathedMethod } from "../shared/define-method.js";
import type { ConfluenceSession } from "./session.js";

/**
 * Lists a page the run wrote with what the linter did: the entity goes in the
 * footer's Created/Updated list, the lint result on a line of its own.
 */
function reportPage(
  ctx: ExtensionContext,
  page: {
    action: "created" | "updated";
    id: string;
    title: string;
    version: number | null;
    fixes: string[];
    warnings: string[];
  },
): void {
  ctx.report[page.action](`page ${page.id} "${page.title}"`);
  const parts = [
    `Page ${page.id} "${page.title}" ${page.action}${page.version ? ` (v${page.version})` : ""}`,
  ];
  if (page.fixes.length > 0) parts.push(`fixes: ${page.fixes.join("; ")}`);
  if (page.warnings.length > 0)
    parts.push(`warnings: ${page.warnings.join("; ")}`);
  if (page.fixes.length + page.warnings.length === 0) parts.push("lint clean");
  ctx.report.note(parts.join(" · "));
}

/** Uploads one file; a same-name upload is a new version (updated), otherwise a new attachment (created). */
export async function uploadAttachment(
  session: ConfluenceSession,
  pageId: string,
  file: LoadedAttachment,
  comment?: string,
): Promise<UploadedAttachment> {
  const uploaded = await uploadFile(session, pageId, file, comment);
  const label = `attachment ${uploaded.id} on page ${pageId}`;
  if ((uploaded.version ?? 1) > 1)
    session.ctx.report.updated(`${label} (new version)`);
  else session.ctx.report.created(label);
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

/** Lints the storage body and turns malformed XML into a precise rejection (before any HTTP). */
export function finalizeBody(
  body: string,
  title: string,
  toc: boolean,
  attachments: LoadedAttachment[],
  context: {
    /** Attachments already on the page (update). */
    existing?: ReadonlyMap<
      string,
      { width: number; height: number } | undefined
    >;
  } = {},
) {
  const images = new Map<string, { width: number; height: number }>();
  for (const [name, size] of context.existing ?? []) {
    if (size) images.set(name, size);
  }
  for (const file of attachments) {
    if (file.width && file.height) {
      images.set(file.filename, { width: file.width, height: file.height });
    }
  }
  const known = new Set([
    ...(context.existing?.keys() ?? []),
    ...attachments.map((file) => file.filename),
  ]);
  try {
    return lintStoragePage(body, { title, toc, images, attachments: known });
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

type PageAttachment = {
  title: string;
  downloadLink?: string;
  mediaType: string;
};

async function listPageAttachments(
  session: ConfluenceSession,
  connection: ConfluenceConnection,
  pageId: string,
): Promise<PageAttachment[]> {
  const response = await confluenceRequest(connection, {
    parse: jsonObject,
    path: `/pages/${pathSegment(pageId)}/attachments`,
    query: { limit: 250 },
  });
  return valuesFromConfluenceList(response).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    return typeof item.title === "string"
      ? [
          {
            title: item.title,
            downloadLink:
              typeof item.downloadLink === "string"
                ? item.downloadLink
                : undefined,
            mediaType: typeof item.mediaType === "string" ? item.mediaType : "",
          },
        ]
      : [];
  });
}

const attachmentRefs = (storage: string): Set<string> =>
  new Set(
    [...storage.matchAll(/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/g)].map(
      (m) => m[1],
    ),
  );

/** Attachment names an image without ac:width points to. */
function unsizedImageFiles(storage: string): Set<string> {
  const names = new Set<string>();
  for (const [, attrs, inner] of storage.matchAll(
    /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/g,
  )) {
    if (/\bac:width=/.test(attrs)) continue;
    const name = /<ri:attachment\b[^>]*\bri:filename="([^"]*)"/.exec(
      inner,
    )?.[1];
    if (name) names.add(name);
  }
  return names;
}

const MAX_SIZED_DOWNLOADS = 8;

/**
 * Attachments already on the page that the body references and the new upload
 * does not replace; PNG/JPEG ones that the body shows without a width are
 * downloaded to learn their real size, so the linter can set it.
 */
async function existingReferenced(
  session: ConfluenceSession,
  connection: ConfluenceConnection,
  pageId: string,
  storage: string,
  uploaded: readonly string[],
): Promise<Map<string, { width: number; height: number } | undefined>> {
  const wanted = [...attachmentRefs(storage)].filter(
    (name) => !uploaded.includes(name),
  );
  const found = new Map<
    string,
    { width: number; height: number } | undefined
  >();
  if (wanted.length === 0) return found;
  const onPage = await listPageAttachments(session, connection, pageId);
  const unsized = unsizedImageFiles(storage);
  let downloads = 0;
  for (const name of wanted) {
    const item = onPage.find((candidate) => candidate.title === name);
    if (!item) continue;
    let size: { width: number; height: number } | undefined;
    if (
      unsized.has(name) &&
      item.downloadLink &&
      /^image\/(png|jpeg)$/.test(item.mediaType) &&
      downloads < MAX_SIZED_DOWNLOADS
    ) {
      downloads += 1;
      const bytes = await confluenceDownload(
        connection,
        item.downloadLink,
      ).catch(() => undefined);
      if (bytes && bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
        size = imageSize(bytes);
      }
    }
    found.set(name, size);
  }
  return found;
}

/** The storage body of `body`, or of the artifact/workspace file `bodyFile`; exactly one may be given. */
function bodySource(options: Record<string, unknown>): {
  body?: string;
  bodyFile?: string;
} {
  const body = pageBodyOption(options);
  const bodyFile =
    options.bodyFile === undefined
      ? undefined
      : nonEmptyString(options.bodyFile, "bodyFile");
  if (body !== undefined && bodyFile !== undefined) {
    throw new Error("Pass body or bodyFile, not both.");
  }
  return { body, bodyFile };
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

/** The body is storage XHTML here: the sandbox converts RichText (Markdown, builders, arrays) before the call. */
export function pageBodyOption(options: Record<string, unknown>) {
  if (options.body !== undefined && typeof options.body !== "string") {
    throw new Error(
      "body must be RichText: a Markdown string, storage.* output or an array of those.",
    );
  }
  return options.body;
}

/** `pages.create`, `pages.update` and `pages.download`: storage bodies, linted, with attachments. */
export const confluencePageWriteMethods: PathedMethod<ConfluenceSession>[] = [
  defineMethod({
    product: "confluence",
    path: "pages.create",
    risk: "external_write",
    options: ["space", "title", "parent", "body", "toc", "attachments"],
    signature:
      "/** Linted on write. Pass `attachments` for files the body references. */ create(options: { space?: string; title: string; parent?: string; body: RichText; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>",
    parse: (options) => {
      const body = pageBodyOption(options) ?? "";
      if (!body.trim()) throw new Error("body must not be empty.");
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
    authorize: ({ space, title }) => ({
      targets: space ? [confluenceSpace(space)] : [],
      summary: `${space ?? "default space"}/${title}`,
    }),
    // Attaching files is part of creating the page; only the file reads need their own check.
    authorizeAlso: ({ attachments }) =>
      attachmentReadAuthorizations(attachments),
    resource: ({ space }) => `space ${space ?? "(default)"}`,
    async run({ space, title, parent, body, toc, attachments }, session) {
      const connection = session.connection;
      // Read, validate and size attachments first so bad input fails before the page exists.
      const loaded = await loadAttachments(attachments, session);
      const page = finalizeBody(body, title, toc, loaded);
      const { spaceId } = await resolveSpace(session, space);
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
      });
      const result = compactPage(connection, created, { title, version: 1 });
      const uploaded: UploadedAttachment[] = [];
      let version = result.version;
      try {
        for (const [index, file] of loaded.entries()) {
          uploaded.push(
            await uploadAttachment(
              session,
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
      const warnings = page.warnings;
      reportPage(session.ctx, {
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
    risk: "external_write",
    options: [
      "id",
      "version",
      "title",
      "body",
      "bodyFile",
      "allowRemoving",
      "message",
      "toc",
      "attachments",
    ],
    signature:
      '/** Replaces the whole body. Edit: [page.body, "## New"], storage.replaceSection(page.body, heading, content), or pages.download + bodyFile (exclusive with body). Dropping macros/layouts/images/mentions throws unless allowRemoving. Pass the version you read (CONFLICT if newer). */ update(options: { id: string; version?: number; title?: string; body?: RichText; bodyFile?: FileHandle; allowRemoving?: boolean; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>',
    parse: (options) => {
      const { body, bodyFile } = bodySource(options);
      const title = optionalText(options.title);
      if (body === undefined && bodyFile === undefined && !title) {
        throw new Error("Provide a title, a body or a bodyFile to update.");
      }
      return {
        id: nonEmptyString(options.id, "id"),
        version: versionOption(options.version),
        title,
        body,
        bodyFile,
        allowRemoving: options.allowRemoving === true,
        message: optionalText(options.message),
        toc: options.toc !== false,
        attachments: attachmentSpecs(options.attachments),
      };
    },
    authorize: ({ id }) => ({
      targets: [confluencePage(id)],
      summary: id,
    }),
    authorizeAlso: ({ bodyFile, attachments }) =>
      attachmentReadAuthorizations([
        ...attachments,
        ...(bodyFile ? [{ file: bodyFile }] : []),
      ]),
    resource: ({ id }) => `page ${id}`,
    async run(
      {
        id,
        version,
        title,
        body: inlineBody,
        bodyFile,
        allowRemoving,
        message,
        toc,
        attachments,
      },
      session,
    ) {
      const connection = session.connection;
      const loaded = await loadAttachments(attachments, session);
      const body =
        bodyFile === undefined
          ? inlineBody
          : new TextDecoder().decode(
              (await session.ctx.artifacts.read(bodyFile)).bytes,
            );
      const current = await fetchPageCurrent(connection, id);
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
          `page ${id} is at v${currentVersion}, you read v${version}; re-read the page and reapply your change`,
        );
      }
      const currentBody = (
        current.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const nextTitle =
        title ?? (typeof current.title === "string" ? current.title : id);
      const page =
        body !== undefined
          ? finalizeBody(body, nextTitle, toc, loaded, {
              existing: await existingReferenced(
                session,
                connection,
                id,
                body,
                loaded.map((file) => file.filename),
              ),
            })
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
            `update would remove ${removed}. Build the body from the current one ([page.body, ...] or storage.replaceSection(page.body, ...) after pages.get({ id, body: "storage" })), or pass allowRemoving: true.`,
          );
        }
      }
      const uploaded: UploadedAttachment[] = [];
      let updated;
      try {
        for (const [index, file] of loaded.entries()) {
          uploaded.push(
            await uploadAttachment(
              session,
              id,
              file,
              attachments[index].comment,
            ),
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
      reportPage(session.ctx, {
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
  defineMethod({
    product: "confluence",
    path: "pages.download",
    risk: "network",
    options: ["id", "attachments"],
    signature:
      "/** Saves storage XHTML as artifact:page-<id>.xhtml; edit it, then pages.update({ id, version, bodyFile: file }). attachments: true also saves attachments. */ download(options: { id: string; attachments?: boolean }): Promise<{ file: FileHandle; version: number; title: string; attachments?: { filename: string; file: FileHandle }[]; skipped?: string[] }>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      attachments: options.attachments === true,
    }),
    authorize: ({ id }) => ({
      targets: [confluencePage(id)],
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, attachments }, session) {
      const connection = session.connection;
      const page = await fetchPageCurrent(connection, id);
      const storage = (
        page.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const file = (
        await session.ctx.artifacts.write(
          `page-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.xhtml`,
          typeof storage === "string" ? storage : "",
          "application/xhtml+xml",
        )
      ).handle;
      const versionNumber = (page.version as { number?: unknown } | undefined)
        ?.number;
      const result: Record<string, unknown> = {
        file,
        version: typeof versionNumber === "number" ? versionNumber : null,
        title: typeof page.title === "string" ? page.title : id,
      };
      if (attachments) {
        const saved: { filename: string; file: string }[] = [];
        const skipped: string[] = [];
        for (const item of await listPageAttachments(session, connection, id)) {
          const bytes = item.downloadLink
            ? await confluenceDownload(connection, item.downloadLink)
            : undefined;
          if (!bytes || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            skipped.push(item.title);
            continue;
          }
          saved.push({
            filename: item.title,
            file: (
              await session.ctx.artifacts.write(
                `${id}-${artifactNameFor(item.title)}`.slice(0, 128),
                bytes,
                mediaTypeFor(item.title),
              )
            ).handle,
          });
        }
        result.attachments = saved;
        if (skipped.length > 0) result.skipped = skipped;
      }
      return result;
    },
  }),
];
