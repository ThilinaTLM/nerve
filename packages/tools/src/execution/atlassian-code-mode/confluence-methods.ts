import { jsonObject } from "../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
  requireConfluenceConnection,
} from "../confluence/client.js";
import { pageWebUrl, valuesFromConfluenceList } from "../confluence/format.js";
import { storageXmlToMarkdown } from "../confluence/markdown.js";
import { markdownToStorage } from "../confluence/markdown-to-storage.js";
import { fetchPageCurrent } from "../confluence/page-resolution.js";
import { resolveSpaceId } from "../confluence/space-resolution.js";
import {
  clampInt,
  identifierArgs,
  nonEmptyString,
  objectArg,
  optionalText,
} from "./sdk-args.js";
import {
  type CodeModeContext,
  defineMethod,
  type HostFile,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";
import {
  type AttachmentSpec,
  attachmentReadAuthorizations,
  attachmentUploadAuthorizations,
  loadAttachment,
  parseAttachmentSpec,
  type UploadedAttachment,
  uploadAttachment,
} from "./attachments.js";
import { lintStoragePage } from "../confluence/page-lint.js";
import { StorageXmlError } from "../confluence/storage-xml.js";
import {
  expandMarkdownMarkers,
  hasMarkdownMarkers,
} from "./storage-helpers.js";

const PAGE_ID_ALIASES = ["id", "pageId", "page_id", "page"];
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;
const MAX_SPACE_PAGES = 10;

type BodyFormat = "markdown" | "storage";

function formatOption(
  value: unknown,
  body: string,
  defaultFormat: "storage" | "auto" = "auto",
): BodyFormat {
  if (value === "markdown" || value === "storage") return value;
  if (value !== undefined)
    throw new Error('format must be "markdown" or "storage".');
  // Bodies built with storage.* helpers are storage even when format is omitted.
  if (hasMarkdownMarkers(body)) return "storage";
  // Pages default to storage; a body with no markup at all can only be Markdown prose.
  if (defaultFormat === "storage") {
    return body.trim() === "" || body.trimStart().startsWith("<")
      ? "storage"
      : "markdown";
  }
  return "markdown";
}

function attachmentSpecs(value: unknown): AttachmentSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      "attachments must be an array of { path | file, filename? }.",
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
  attachments: HostFile[],
) {
  const images = new Map<string, { width: number; height: number }>();
  for (const file of attachments) {
    if (file.width && file.height) {
      images.set(file.filename, { width: file.width, height: file.height });
    }
  }
  try {
    return lintStoragePage(toStorage(body, format), { title, toc, images });
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

function toStorage(body: string, format: BodyFormat): string {
  return format === "storage"
    ? expandMarkdownMarkers(body)
    : markdownToStorage(body);
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

export const confluenceMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "spaces.search",
    signature:
      "spaces.search(query?): Promise<{ id, key, name, type, url }[]>  // key or name contains",
    parse: ([first]) =>
      typeof first === "string"
        ? first.trim()
        : (optionalText(objectArg(first).query)?.trim() ?? ""),
    authorize: (query) => ({
      toolName: "confluence_search_spaces",
      args: query ? { keys: [query] } : {},
      summary: query || "all spaces",
    }),
    async run(query, env) {
      const connection = await env.confluence();
      const needle = query.toLowerCase();
      const spaces: Array<Record<string, unknown>> = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_SPACE_PAGES; page++) {
        const response = await confluenceRequest(connection, {
          parse: jsonObject,
          path: "/spaces",
          query: { limit: 250, cursor },
          signal: env.context.signal,
        });
        for (const raw of valuesFromConfluenceList(response)) {
          const space = raw as Record<string, unknown>;
          const key = String(space.key ?? "");
          const name = String(space.name ?? "");
          if (
            needle &&
            !key.toLowerCase().includes(needle) &&
            !name.toLowerCase().includes(needle)
          )
            continue;
          spaces.push({
            id: String(space.id ?? ""),
            key,
            name,
            type: space.type ?? null,
            url: `${connection.siteUrl}/wiki/spaces/${key}`,
          });
        }
        const next = (response._links as { next?: unknown } | undefined)?.next;
        cursor =
          typeof next === "string"
            ? (new URL(next, "https://example.invalid").searchParams.get(
                "cursor",
              ) ?? undefined)
            : undefined;
        if (!cursor) break;
      }
      return spaces;
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.search",
    signature:
      "pages.search({ cql?, space?, title?, limit? }): Promise<{ id, title, space, url, updated, parentId }[]>  // limit 25, max 250; title contains",
    parse: ([first]) => {
      const options =
        typeof first === "string" ? { cql: first } : objectArg(first);
      const space = optionalText(options.space ?? options.spaceKey);
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
    signature:
      'pages.get(id | { space, title }, { body?: "markdown"|"storage"|false, children? }): Promise<{ id, title, space, url, version, parentId, labels, body, children? }>',
    parse: (args) => {
      const first = args[0];
      const record =
        first && typeof first === "object"
          ? (first as Record<string, unknown>)
          : undefined;
      const lookup =
        record && !PAGE_ID_ALIASES.some((alias) => record[alias] !== undefined)
          ? {
              space: optionalText(record.space ?? record.spaceKey),
              title: nonEmptyString(record.title, "title"),
            }
          : undefined;
      const { value, options } = lookup
        ? { value: undefined, options: { ...record, ...objectArg(args[1]) } }
        : identifierArgs(args, PAGE_ID_ALIASES, "id");
      const body = options.body === undefined ? "markdown" : options.body;
      if (body !== false && body !== "markdown" && body !== "storage") {
        throw new Error('body must be "markdown", "storage" or false.');
      }
      return { id: value, lookup, body, children: options.children === true };
    },
    authorize: ({ id, lookup }) => ({
      toolName: "confluence_get_page",
      args: id
        ? { page_id: id }
        : {
            ...(lookup?.space ? { space_key: lookup.space } : {}),
            title: lookup?.title,
          },
      summary: id ?? `${lookup?.space ?? "default space"}/${lookup?.title}`,
    }),
    async run({ id, lookup, body, children }, env) {
      const connection = await env.confluence();
      let pageId = id;
      if (!pageId) {
        const { spaceId } = await resolveSpaceId(connection, {
          spaceKey: lookup?.space,
          signal: env.context.signal,
        });
        const found = await confluenceRequest(connection, {
          parse: jsonObject,
          path: "/pages",
          query: { "space-id": spaceId, title: lookup?.title, limit: 1 },
          signal: env.context.signal,
        });
        const first = valuesFromConfluenceList(found)[0] as
          | { id?: unknown }
          | undefined;
        if (!first?.id) {
          throw new Error(
            `No Confluence page titled "${lookup?.title}" found.`,
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
    signature:
      'pages.create({ space, title, parent?, body, format?: "storage"|"markdown", toc?, attachments? }): Promise<{ id, title, url, version, fixes, warnings, attachments? }>  // body is storage XHTML (build with storage.*); linted on write',
    parse: ([first]) => {
      const options = objectArg(first);
      const body = typeof options.body === "string" ? options.body : "";
      if (!body.trim()) throw new Error("body must be a non-empty string.");
      return {
        space: optionalText(options.space ?? options.spaceKey),
        title: nonEmptyString(options.title, "title"),
        parent:
          options.parent === undefined
            ? undefined
            : nonEmptyString(options.parent, "parent"),
        body,
        format: formatOption(options.format, body, "storage"),
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
    async run({ space, title, parent, body, format, toc, attachments }, env) {
      const connection = await env.confluence();
      // Read, validate and size attachments first so bad input fails before the page exists.
      const loaded = await Promise.all(
        attachments.map((spec) => loadAttachment(spec, env)),
      );
      const page = finalizeBody(body, format, title, toc, loaded);
      const { spaceId } = await resolveSpaceId(connection, {
        spaceKey: space,
        signal: env.context.signal,
      });
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
      const referenced = referencedAttachments(page.storage);
      const missing = referenced.filter(
        (name) => !uploaded.some((u) => u.filename === name),
      );
      return {
        ...result,
        version,
        fixes: page.fixes,
        warnings: [
          ...page.warnings,
          ...missing.map(
            (name) =>
              `Body references attachment "${name}" that was not attached; pass it in attachments.`,
          ),
        ],
        ...(uploaded.length ? { attachments: uploaded } : {}),
      };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.update",
    signature:
      "pages.update(id, { title?, body?, format?, message?, toc?, attachments? }): Promise<{ id, title, url, version, fixes, warnings, attachments? }>  // replaces body; version bumped for you; linted on write",
    parse: (args) => {
      const { value, options } = identifierArgs(args, PAGE_ID_ALIASES, "id");
      const body = typeof options.body === "string" ? options.body : undefined;
      const title = optionalText(options.title);
      if (body === undefined && !title)
        throw new Error("Provide a title and/or body to update.");
      return {
        id: value,
        title,
        body,
        format: formatOption(options.format, body ?? "", "storage"),
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
      return {
        ...compactPage(
          connection,
          { ...updated, id },
          { title: nextTitle, version: currentVersion + 1 },
        ),
        fixes: page.fixes,
        warnings: page.warnings,
        ...(uploaded.length ? { attachments: uploaded } : {}),
      };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "attachments.upload",
    signature:
      "attachments.upload(pageId, { path | file, filename?, comment? }): Promise<{ id, filename, mediaType, size, width?, height? }>  // path = workspace file, file = diagram.render handle; PNG/JPEG only for images (GIF/WebP converted, SVG rejected)",
    parse: (args) => {
      const { value, options } = identifierArgs(
        args.slice(0, 1),
        PAGE_ID_ALIASES,
        "pageId",
      );
      return {
        id: value,
        spec: parseAttachmentSpec({ ...options, ...objectArg(args[1]) }),
      };
    },
    authorize: ({ id, spec }) => attachmentUploadAuthorizations(id, [spec])[0],
    authorizeAlso: ({ spec }, env) => attachmentReadAuthorizations([spec], env),
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
    signature:
      "labels.add(pageId, labels: string | string[]): Promise<{ id, labels }>",
    parse: (args) => {
      const { value, options } = identifierArgs(
        args.slice(0, 1),
        PAGE_ID_ALIASES,
        "pageId",
      );
      const raw = args[1] ?? options.labels ?? options.label;
      const labels = (Array.isArray(raw) ? raw : [raw])
        .map((label) => (typeof label === "string" ? label.trim() : ""))
        .filter(Boolean);
      if (labels.length === 0) {
        throw new Error(
          "labels must be a non-empty string or array of strings.",
        );
      }
      return { id: value, labels };
    },
    authorize: ({ id, labels }) => ({
      toolName: "confluence_manage_label",
      args: { action: "add", page_id: id, label: labels[0], prefix: "global" },
      summary: `${id} +${labels.join(",")}`,
    }),
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
    signature:
      'comments.add(pageId, body, { format?: "markdown"|"storage" }): Promise<{ id, pageId }>  // footer comment',
    parse: (args) => {
      const { value, options } = identifierArgs(
        args.slice(0, 1),
        PAGE_ID_ALIASES,
        "pageId",
      );
      const body = typeof args[1] === "string" ? args[1] : options.body;
      if (typeof body !== "string" || !body.trim()) {
        throw new Error("body must be a non-empty string.");
      }
      const extra = typeof args[1] === "string" ? args[2] : args[1];
      const opts = { ...options, ...objectArg(extra) };
      return { id: value, body, format: formatOption(opts.format, body) };
    },
    authorize: ({ id, body }) => ({
      toolName: "confluence_manage_comment",
      args: { action: "create", kind: "footer", page_id: id, body },
      summary: id,
    }),
    async run({ id, body, format }, env) {
      const created = await confluenceRequest(await env.confluence(), {
        parse: jsonObject,
        method: "POST",
        path: "/footer-comments",
        body: {
          pageId: id,
          body: { representation: "storage", value: toStorage(body, format) },
        },
        signal: env.context.signal,
      });
      return { id: String(created.id ?? ""), pageId: id };
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
