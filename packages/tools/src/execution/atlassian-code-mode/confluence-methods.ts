import { jsonObject } from "../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRawRequest,
  confluenceRequest,
  pathSegment,
  requireConfluenceConnection,
} from "../confluence/client.js";
import { pageWebUrl, valuesFromConfluenceList } from "../confluence/format.js";
import { storageXmlToMarkdown } from "../confluence/markdown.js";
import { markdownToStorage } from "../confluence/markdown-to-storage.js";
import { lintStoragePage } from "../confluence/page-lint.js";
import { fetchPageCurrent } from "../confluence/page-resolution.js";
import { StorageXmlError } from "../confluence/storage-xml.js";
import { listSpaces, resolveSpace } from "./confluence-spaces.js";
import { rawMethod } from "../atlassian/raw-request.js";
import {
  type AttachmentSpec,
  attachmentReadAuthorizations,
  attachmentUploadAuthorizations,
  loadAttachment,
  type LoadedAttachment,
  parseAttachmentSpec,
  type UploadedAttachment,
  uploadAttachment,
} from "./attachments.js";
import { clampInt, nonEmptyString, optionalText } from "./sdk-args.js";
import {
  type CodeModeContext,
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;

type BodyFormat = "markdown" | "storage";

/** Pages default to storage; a body with no markup at all can only be Markdown prose. */
function formatOption(
  value: unknown,
  body: string,
  defaultFormat: "storage" | "markdown" = "storage",
): BodyFormat {
  if (value === "markdown" || value === "storage") return value;
  if (value !== undefined) {
    throw new Error('format must be "markdown" or "storage".');
  }
  if (defaultFormat === "markdown") return "markdown";
  return body.trim() === "" || body.trimStart().startsWith("<")
    ? "storage"
    : "markdown";
}

function attachmentSpecs(value: unknown): AttachmentSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      "attachments must be an array of file handles or { file, filename? }.",
    );
  }
  return value.map(parseAttachmentSpec);
}

/** Converts to storage, lints, and turns malformed XML into a precise rejection (before any HTTP). */
function finalizeBody(
  body: string,
  format: BodyFormat,
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
    return lintStoragePage(
      format === "storage" ? body : markdownToStorage(body),
      { title, toc, images },
    );
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

function referencedAttachments(storage: string): string[] {
  return [
    ...storage.matchAll(/<ri:attachment\b[^>]*\bri:filename="([^"]*)"/g),
  ].map((m) => m[1]);
}

function pageUrl(
  connection: ConfluenceConnection,
  page: Record<string, unknown>,
) {
  return (
    pageWebUrl(connection.siteUrl, page) ??
    `${connection.siteUrl}/wiki/pages/viewpage.action?pageId=${String(page.id ?? "")}`
  );
}

function compactPage(
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

function escapeCql(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function labelNames(value: unknown): string[] {
  return valuesFromConfluenceList(value).flatMap((item) => {
    const name = (item as { name?: unknown } | null)?.name;
    return typeof name === "string" ? [name] : [];
  });
}

function pageBodyOption(options: Record<string, unknown>) {
  const body = typeof options.body === "string" ? options.body : undefined;
  return body;
}

export const confluenceMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "spaces.search",
    risk: "read",
    bare: "query",
    options: ["query"],
    signature:
      "/** Contains match on key or name. */ search(options?: string | { query?: string }): Promise<Space[]>",
    parse: (options) => optionalText(options.query)?.trim() ?? "",
    authorize: (query) => ({
      toolName: "confluence_search_spaces",
      args: query ? { keys: [query] } : {},
      summary: query || "all spaces",
    }),
    resource: () => "Confluence spaces",
    async run(query, env) {
      const connection = await env.confluence();
      return (await listSpaces(env, query)).map((space) => ({
        ...space,
        type: space.type ?? null,
        url: `${connection.siteUrl}/wiki/spaces/${space.key}`,
      }));
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.search",
    risk: "read",
    bare: "cql",
    options: ["cql", "space", "title", "limit"],
    signature:
      "/** Needs cql, space or title (contains); ANDed. limit default 25, max 250. */ search(options: string | { cql?: string; space?: string; title?: string; limit?: number }): Promise<PageSummary[]>",
    parse: (options) => {
      const space = optionalText(options.space);
      const title = optionalText(options.title);
      const explicitCql = optionalText(options.cql);
      const parts = explicitCql ? [`(${explicitCql})`] : ["type = page"];
      if (space) parts.push(`space = "${escapeCql(space)}"`);
      if (title) parts.push(`title ~ "${escapeCql(title)}"`);
      if (parts.length === 1 && !explicitCql) {
        throw new Error("Provide at least one of cql, space or title.");
      }
      return {
        cql: parts.join(" AND "),
        limit: clampInt(options.limit, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
        space,
        title,
      };
    },
    authorize: ({ cql, space, title }) => ({
      toolName: "confluence_search_pages",
      args: {
        cql,
        ...(space ? { space_key: space } : {}),
        ...(title ? { title } : {}),
      },
      summary: cql,
    }),
    resource: () => "this Confluence search",
    async run({ cql, limit }, env) {
      const connection = await env.confluence();
      const pages: Array<Record<string, unknown>> = [];
      let start = 0;
      while (pages.length < limit) {
        const batch = Math.min(100, limit - pages.length);
        const response = await confluenceRequest(connection, {
          api: "v1",
          parse: jsonObject,
          path: "/content/search",
          query: {
            cql,
            limit: batch,
            start,
            expand: "space,version,ancestors",
          },
          signal: env.context.signal,
        });
        const results = valuesFromConfluenceList(response) as Array<
          Record<string, unknown>
        >;
        for (const page of results) {
          const ancestors = Array.isArray(page.ancestors) ? page.ancestors : [];
          pages.push({
            id: String(page.id ?? ""),
            title: page.title ?? null,
            space: (page.space as { key?: unknown } | undefined)?.key ?? null,
            url: pageUrl(connection, page),
            updated:
              (page.version as { when?: unknown } | undefined)?.when ?? null,
            parentId:
              (ancestors.at(-1) as { id?: unknown } | undefined)?.id ?? null,
          });
        }
        start += results.length;
        if (results.length < batch) break;
      }
      return pages;
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.get",
    risk: "read",
    bare: "id",
    options: ["id", "space", "title", "body", "children"],
    signature:
      '/** By id, or by exact title (space defaults to the configured one). body defaults to "markdown". */ get(options: string | { id: string; body?: "markdown" | "storage" | false; children?: boolean } | { space?: string; title: string; body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>',
    parse: (options) => {
      const id =
        options.id === undefined ? undefined : nonEmptyString(options.id, "id");
      const title = id
        ? undefined
        : nonEmptyString(options.title, "title (or id)");
      const body = options.body === undefined ? "markdown" : options.body;
      if (body !== false && body !== "markdown" && body !== "storage") {
        throw new Error('body must be "markdown", "storage" or false.');
      }
      return {
        id,
        space: optionalText(options.space),
        title,
        body,
        children: options.children === true,
      };
    },
    authorize: ({ id, space, title }) => ({
      toolName: "confluence_get_page",
      args: id
        ? { page_id: id }
        : { ...(space ? { space_key: space } : {}), title },
      summary: id ?? `${space ?? "default space"}/${title}`,
    }),
    resource: ({ id, title }) => (id ? `page ${id}` : `page "${title}"`),
    async run({ id, space, title, body, children }, env) {
      const connection = await env.confluence();
      let pageId = id;
      if (!pageId) {
        const { spaceId, spaceKey } = await resolveSpace(env, space);
        const found = await confluenceRequest(connection, {
          parse: jsonObject,
          path: "/pages",
          query: { "space-id": spaceId, title, limit: 1 },
          signal: env.context.signal,
        });
        const first = valuesFromConfluenceList(found)[0] as
          | { id?: unknown }
          | undefined;
        if (!first?.id) {
          throw new Error(
            `No Confluence page titled "${title}" in space ${spaceKey ?? space ?? "(default)"}. Use confluence.pages.search({ title }) to find similar titles.`,
          );
        }
        pageId = String(first.id);
      }
      const page = await confluenceRequest(connection, {
        parse: jsonObject,
        path: `/pages/${pathSegment(pageId)}`,
        query: {
          "body-format": body === false ? undefined : "storage",
          "include-labels": true,
          "include-version": true,
        },
        signal: env.context.signal,
      });
      const spaceId =
        page.spaceId === undefined ? undefined : String(page.spaceId);
      const keys = spaceId
        ? await env.confluenceSpaceKeys([spaceId])
        : new Map<string, string>();
      const storage = (
        page.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const result: Record<string, unknown> = {
        ...compactPage(connection, page),
        space: (spaceId && keys.get(spaceId)) ?? spaceId ?? null,
        parentId: page.parentId ?? null,
        labels: labelNames(page.labels),
      };
      if (body !== false) {
        const xml = typeof storage === "string" ? storage : "";
        result.body =
          body === "storage"
            ? xml
            : await storageXmlToMarkdown(xml, env.context.signal);
      }
      if (children) {
        const response = await confluenceRequest(connection, {
          path: `/pages/${pathSegment(pageId)}/direct-children`,
          query: { limit: 100 },
          signal: env.context.signal,
        }).catch(() =>
          confluenceRequest(connection, {
            path: `/pages/${pathSegment(pageId)}/children`,
            query: { limit: 100 },
            signal: env.context.signal,
          }),
        );
        result.children = valuesFromConfluenceList(response).map((child) => ({
          id: String((child as { id?: unknown }).id ?? ""),
          title: (child as { title?: unknown }).title ?? null,
        }));
      }
      return result;
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.create",
    risk: "write",
    options: [
      "space",
      "title",
      "parent",
      "body",
      "format",
      "toc",
      "attachments",
    ],
    signature:
      '/** body is storage XHTML from storage.*, linted on write. Pass attachments for images the body references. */ create(options: { space?: string; title: string; parent?: string; body: string; format?: "storage" | "markdown"; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>',
    parse: (options) => {
      const body = pageBodyOption(options) ?? "";
      if (!body.trim()) throw new Error("body must be a non-empty string.");
      return {
        space: optionalText(options.space),
        title: nonEmptyString(options.title, "title"),
        parent:
          options.parent === undefined
            ? undefined
            : nonEmptyString(options.parent, "parent"),
        body,
        format: formatOption(options.format, body),
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
    async run({ space, title, parent, body, format, toc, attachments }, env) {
      const connection = await env.confluence();
      // Read, validate and size attachments first so bad input fails before the page exists.
      const loaded = await Promise.all(
        attachments.map((spec) => loadAttachment(spec, env)),
      );
      const page = finalizeBody(body, format, title, toc, loaded);
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
      let version = result.version;
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
            version: { number: (version ?? 1) + 1, message: "Attach images" },
          },
          signal: env.context.signal,
        });
        version =
          (updated.version as { number?: number } | undefined)?.number ??
          (version ?? 1) + 1;
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
    options: ["id", "title", "body", "format", "message", "toc", "attachments"],
    signature:
      '/** Replaces the whole body (read body: "storage" first to edit); omitted title/body are kept. */ update(options: { id: string; title?: string; body?: string; format?: "storage" | "markdown"; message?: string; toc?: boolean; attachments?: AttachmentInput[] }): Promise<PageWrite>',
    parse: (options) => {
      const body = pageBodyOption(options);
      const title = optionalText(options.title);
      if (body === undefined && !title) {
        throw new Error("Provide a title and/or body to update.");
      }
      return {
        id: nonEmptyString(options.id, "id"),
        title,
        body,
        format: formatOption(options.format, body ?? ""),
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
    async run({ id, title, body, format, message, toc, attachments }, env) {
      const connection = await env.confluence();
      const loaded = await Promise.all(
        attachments.map((spec) => loadAttachment(spec, env)),
      );
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
      const currentBody = (
        current.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const nextTitle =
        title ?? (typeof current.title === "string" ? current.title : id);
      const page =
        body !== undefined
          ? finalizeBody(body, format, nextTitle, toc, loaded)
          : {
              storage: typeof currentBody === "string" ? currentBody : "",
              fixes: [],
              warnings: [],
            };
      const uploaded: UploadedAttachment[] = [];
      for (const [index, file] of loaded.entries()) {
        uploaded.push(
          await uploadAttachment(env, id, file, attachments[index].comment),
        );
      }
      const updated = await confluenceRequest(connection, {
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
    path: "attachments.upload",
    risk: "write",
    options: ["id", "file", "filename", "comment"],
    signature:
      "/** Same filename replaces. SVG rejected; max 20 MB. */ upload(options: { id: string; file: FileHandle; filename?: string; comment?: string }): Promise<AttachmentInfo>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      spec: parseAttachmentSpec({
        file: options.file,
        filename: options.filename,
        comment: options.comment,
      }),
    }),
    authorize: ({ id, spec }) => attachmentUploadAuthorizations(id, [spec])[0],
    authorizeAlso: ({ spec }, env) => attachmentReadAuthorizations([spec], env),
    resource: ({ id }) => `page ${id}`,
    async run({ id, spec }, env) {
      return await uploadAttachment(
        env,
        id,
        await loadAttachment(spec, env),
        spec.comment,
      );
    },
  }),
  defineMethod({
    product: "confluence",
    path: "labels.add",
    risk: "write",
    options: ["id", "labels"],
    signature:
      "add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>",
    parse: (options) => {
      const raw = options.labels;
      const labels = (Array.isArray(raw) ? raw : [raw])
        .map((label) => (typeof label === "string" ? label.trim() : ""))
        .filter(Boolean);
      if (labels.length === 0) {
        throw new Error(
          "labels must be a non-empty string or array of strings.",
        );
      }
      return { id: nonEmptyString(options.id, "id"), labels };
    },
    authorize: ({ id, labels }) => ({
      toolName: "confluence_manage_label",
      args: { action: "add", page_id: id, label: labels[0], prefix: "global" },
      summary: `${id} +${labels.join(",")}`,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, labels }, env) {
      await confluenceRequest(await env.confluence(), {
        api: "v1",
        method: "POST",
        path: `/content/${pathSegment(id)}/label`,
        body: labels.map((name) => ({ prefix: "global", name })),
        signal: env.context.signal,
      });
      return { id, labels };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.add",
    risk: "write",
    options: ["id", "body", "format"],
    signature:
      '/** Footer comment; Markdown unless format is "storage". */ add(options: { id: string; body: string; format?: "markdown" | "storage" }): Promise<{ id: string; pageId: string }>',
    parse: (options) => {
      const body = pageBodyOption(options);
      if (!body?.trim()) throw new Error("body must be a non-empty string.");
      return {
        id: nonEmptyString(options.id, "id"),
        body,
        format: formatOption(options.format, body, "markdown"),
      };
    },
    authorize: ({ id, body }) => ({
      toolName: "confluence_manage_comment",
      args: { action: "create", kind: "footer", page_id: id, body },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, body, format }, env) {
      const created = await confluenceRequest(await env.confluence(), {
        parse: jsonObject,
        method: "POST",
        path: "/footer-comments",
        body: {
          pageId: id,
          body: {
            representation: "storage",
            value: format === "storage" ? body : markdownToStorage(body),
          },
        },
        signal: env.context.signal,
      });
      return { id: String(created.id ?? ""), pageId: id };
    },
  }),
  definePositionalMethod({
    product: "confluence",
    path: "request",
    risk: "destructive",
    maxArgs: 3,
    signature:
      '/** Path under /wiki/api/v2/ or /wiki/rest/api/. Returns JSON or text; non-GET is a destructive write. */ request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown>',
    parse: ([method, path, body]) => ({
      method: rawMethod(method),
      path,
      body,
    }),
    // GET is a read; anything else cannot be analysed, so it is checked as the
    // most destructive `confluence_manage_page` action (a purge).
    authorize: ({ method, path }) => ({
      toolName:
        method === "GET" ? "confluence_get_page" : "confluence_manage_page",
      args:
        method === "GET" ? { method, path } : { action: "purge", method, path },
      summary: `${method} ${String(path)}`,
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body }, env) {
      return await confluenceRawRequest(await env.confluence(), {
        method,
        path,
        body,
        signal: env.context.signal,
      });
    },
  }),
];

export function confluenceConnectionLoader(context: CodeModeContext) {
  let connection: Promise<ConfluenceConnection> | undefined;
  return () => (connection ??= requireConfluenceConnection(context));
}

export function confluenceSpaceKeyLoader(
  context: CodeModeContext,
  connection: () => Promise<ConfluenceConnection>,
): SdkEnvironment["confluenceSpaceKeys"] {
  const known = new Map<string, string>();
  return async (ids) => {
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const response = await confluenceRequest(await connection(), {
        parse: jsonObject,
        path: "/spaces",
        query: { ids: missing, limit: 250 },
        signal: context.signal,
      }).catch(() => ({}));
      for (const raw of valuesFromConfluenceList(response)) {
        const space = raw as { id?: unknown; key?: unknown };
        if (space.id !== undefined && typeof space.key === "string") {
          known.set(String(space.id), space.key);
        }
      }
    }
    return known;
  };
}
