import { image } from "@nervekit/native";
import { jsonObject } from "../../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceDownload,
  confluenceRequest,
  pathSegment,
} from "../../confluence/client.js";
import {
  pageWebUrl,
  valuesFromConfluenceList,
} from "../../confluence/format.js";
import { lintStoragePage } from "../../confluence/page-lint.js";
import { fetchPageCurrent } from "../../confluence/page-resolution.js";
import { StorageXmlError } from "../../confluence/storage-xml.js";
import { resolveSpace } from "./spaces.js";
import {
  type AttachmentSpec,
  attachmentReadAuthorizations,
  attachmentUploadAuthorizations,
  loadAttachments,
  type LoadedAttachment,
  parseAttachmentSpec,
  type UploadedAttachment,
  uploadAttachment as uploadFile,
} from "../atlassian/attachments.js";
import { removedElements } from "./lossy.js";
import { partialWriteFailure } from "./partial-write.js";
import {
  artifactNameFor,
  MAX_ATTACHMENT_BYTES,
  parseHandle,
  readAuthorizations,
  readFileRef,
  writeArtifact,
} from "../files/artifacts.js";
import { codedError } from "../errors.js";
import { nonEmptyString, optionalText } from "../sdk-args.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../sdk-types.js";

/** Uploads one file; a same-name upload is a new version (updated), otherwise a new attachment (created). */
export async function uploadAttachment(
  env: SdkEnvironment,
  pageId: string,
  file: LoadedAttachment,
  comment?: string,
): Promise<UploadedAttachment> {
  const uploaded = await uploadFile(env, pageId, file, comment);
  const label = `attachment ${uploaded.id} on page ${pageId}`;
  if ((uploaded.version ?? 1) > 1)
    env.report.updated.push(`${label} (new version)`);
  else env.report.created.push(label);
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
  env: SdkEnvironment,
  connection: ConfluenceConnection,
  pageId: string,
): Promise<PageAttachment[]> {
  const response = await confluenceRequest(connection, {
    parse: jsonObject,
    path: `/pages/${pathSegment(pageId)}/attachments`,
    query: { limit: 250 },
    signal: env.context.signal,
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
  env: SdkEnvironment,
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
  const onPage = await listPageAttachments(env, connection, pageId);
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
        env.context.signal,
      ).catch(() => undefined);
      if (bytes && bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
        const info = await image
          .imageInfo(Buffer.from(bytes))
          .catch(() => undefined);
        if (info) size = { width: info.width, height: info.height };
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
export const confluencePageWriteMethods: SdkMethod[] = [
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
      const warnings = page.warnings;
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
    authorizeAlso: ({ id, bodyFile, attachments }, env) => [
      ...attachmentUploadAuthorizations(id, attachments),
      ...attachmentReadAuthorizations(attachments, env),
      ...(bodyFile ? readAuthorizations([parseHandle(bodyFile, env)]) : []),
    ],
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
      env,
    ) {
      const connection = await env.confluence();
      const loaded = await loadAttachments(attachments, env);
      const body =
        bodyFile === undefined
          ? inlineBody
          : (await readFileRef(parseHandle(bodyFile, env))).toString("utf8");
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
                env,
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
      toolName: "confluence_get_page",
      args: { page_id: id },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, attachments }, env) {
      const connection = await env.confluence();
      const page = await fetchPageCurrent(connection, id, env.context.signal);
      const storage = (
        page.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const file = await writeArtifact(
        env,
        `page-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.xhtml`,
        Buffer.from(typeof storage === "string" ? storage : "", "utf8"),
      );
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
        for (const item of await listPageAttachments(env, connection, id)) {
          const bytes = item.downloadLink
            ? await confluenceDownload(
                connection,
                item.downloadLink,
                env.context.signal,
              )
            : undefined;
          if (!bytes || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            skipped.push(item.title);
            continue;
          }
          saved.push({
            filename: item.title,
            file: await writeArtifact(
              env,
              `${id}-${artifactNameFor(item.title)}`.slice(0, 128),
              bytes,
            ),
          });
        }
        result.attachments = saved;
        if (skipped.length > 0) result.skipped = skipped;
      }
      return result;
    },
  }),
];
