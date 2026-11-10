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
import type { IntegrationExecutionContext } from "../execution-context.js";
import {
  clampInt,
  identifierArgs,
  nonEmptyString,
  objectArg,
  optionalText,
} from "./sdk-args.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "./sdk-types.js";
import {
  expandMarkdownMarkers,
  hasMarkdownMarkers,
} from "./storage-helpers.js";

const PAGE_ID_ALIASES = ["id", "pageId", "page_id", "page"];
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;
const MAX_SPACE_PAGES = 10;

type BodyFormat = "markdown" | "storage";

function formatOption(value: unknown, body: string): BodyFormat {
  if (value === "markdown" || value === "storage") return value;
  if (value !== undefined)
    throw new Error('format must be "markdown" or "storage".');
  // Bodies built with storage.* helpers are storage even when format is omitted.
  return hasMarkdownMarkers(body) ? "storage" : "markdown";
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
      'pages.create({ space, title, parent?, body, format?: "markdown"|"storage" }): Promise<{ id, title, url, version }>',
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
        format: formatOption(options.format, body),
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
    async run({ space, title, parent, body, format }, env) {
      const connection = await env.confluence();
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
          body: { representation: "storage", value: toStorage(body, format) },
        },
        signal: env.context.signal,
      });
      return compactPage(connection, created, { title, version: 1 });
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.update",
    signature:
      'pages.update(id, { title?, body?, format?: "markdown"|"storage", message? }): Promise<{ id, title, url, version }>  // replaces body; version bumped for you',
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
        format: formatOption(options.format, body ?? ""),
        message: optionalText(options.message),
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
    async run({ id, title, body, format, message }, env) {
      const connection = await env.confluence();
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
      const updated = await confluenceRequest(connection, {
        parse: jsonObject,
        method: "PUT",
        path: `/pages/${pathSegment(id)}`,
        body: {
          id,
          status: "current",
          title: nextTitle,
          ...(current.parentId ? { parentId: current.parentId } : {}),
          body: {
            representation: "storage",
            value:
              body !== undefined
                ? toStorage(body, format)
                : typeof currentBody === "string"
                  ? currentBody
                  : "",
          },
          version: {
            number: currentVersion + 1,
            ...(message ? { message } : {}),
          },
        },
        signal: env.context.signal,
      });
      return compactPage(
        connection,
        { ...updated, id },
        { title: nextTitle, version: currentVersion + 1 },
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

export function confluenceConnectionLoader(
  context: IntegrationExecutionContext,
) {
  let connection: Promise<ConfluenceConnection> | undefined;
  return () => (connection ??= requireConfluenceConnection(context));
}

export function confluenceSpaceKeyLoader(
  context: IntegrationExecutionContext,
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
