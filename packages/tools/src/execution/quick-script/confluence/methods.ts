import { jsonObject } from "../../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRawRequest,
  confluenceRequest,
  pathSegment,
  requireConfluenceConnection,
} from "../../confluence/client.js";
import { valuesFromConfluenceList } from "../../confluence/format.js";
import { pageMarkdown } from "./page-read.js";
import { listSpaces, resolveSpace } from "./spaces.js";
import { rawMethod } from "../../atlassian/raw-request.js";
import {
  attachmentReadAuthorizations,
  attachmentUploadAuthorizations,
  loadAttachment,
  parseAttachmentSpec,
} from "../atlassian/attachments.js";
import { confluenceAttachmentMethods } from "./attachments.js";
import { withTidyErrors } from "../tidy-errors.js";
import { confluenceCommentMethods } from "./comment-methods.js";
import { confluenceExtraMethods } from "./extra-methods.js";
import {
  compactPage,
  confluencePageWriteMethods,
  pageUrl,
  uploadAttachment,
} from "./page-writes.js";
import { artifactBinarySink } from "../files/artifacts.js";
import { codedError, orNotAvailable } from "../errors.js";
import { clampInt, nonEmptyString, optionalText } from "../sdk-args.js";
import {
  type QuickScriptContext,
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  orWhenUnsupported,
  type SdkMethod,
} from "../sdk-types.js";

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;

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
    risk: "network",
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
    risk: "network",
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
    risk: "network",
    bare: "id",
    options: ["id", "space", "title", "body", "children"],
    signature:
      '/** By id, or by exact title (space defaults to the configured one). body "markdown" (default) is for reading only (mentions as @Name, tasks as - [ ], add-on macros as [drawio macro: name]); to edit use body: "storage", which can be spliced into a RichText array or storage.replaceSection. */ get(options: string | { id: string; body?: "markdown" | "storage" | false; children?: boolean } | { space?: string; title: string; body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>',
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
    // By title there is no page id yet: authorize the lookup as a page search.
    authorize: ({ id, space, title }) => ({
      toolName: id ? "confluence_get_page" : "confluence_search_pages",
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
          throw codedError(
            "NOT_FOUND",
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
        result.body = body === "storage" ? xml : await pageMarkdown(env, xml);
      }
      if (children) {
        const response = await confluenceRequest(connection, {
          path: `/pages/${pathSegment(pageId)}/direct-children`,
          query: { limit: 100 },
          signal: env.context.signal,
        }).catch(
          orWhenUnsupported(() =>
            confluenceRequest(connection, {
              path: `/pages/${pathSegment(pageId)}/children`,
              query: { limit: 100 },
              signal: env.context.signal,
            }),
          ),
        );
        result.children = valuesFromConfluenceList(response).map((child) => ({
          id: String((child as { id?: unknown }).id ?? ""),
          title: (child as { title?: unknown }).title ?? null,
        }));
      }
      return result;
    },
  }),
  ...confluencePageWriteMethods,
  defineMethod({
    product: "confluence",
    path: "attachments.upload",
    risk: "external_write",
    options: ["id", "file", "filename", "comment"],
    signature:
      "/** Same filename replaces. SVG rejected; max 100 MB. */ upload(options: { id: string; file: FileHandle; filename?: string; comment?: string }): Promise<AttachmentInfo>",
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
  ...confluenceAttachmentMethods,
  ...confluenceCommentMethods,
  ...confluenceExtraMethods,
  definePositionalMethod({
    product: "confluence",
    path: "request",
    risk: "destructive",
    maxArgs: 4,
    signature:
      '/** Path under /wiki/api/v2/ or /wiki/rest/api/. Returns JSON or text, a FileHandle for binary (page bodies: use pages.create/update). */ request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | string[]>): Promise<unknown>',
    parse: ([method, path, body, query]) => {
      const verb = rawMethod(method);
      if (verb !== "GET" && usesAtlasDocFormat(body)) {
        throw new Error(
          'atlas_doc_format bodies are not supported. Write pages with confluence.pages.create/update and storage.* (representation "storage").',
        );
      }
      return { method: verb, path, body, query };
    },
    // GET is a read. Anything else cannot be analysed: `confluence_manage_page`
    // (a purge) only supplies the deny rules, and the call always needs the
    // script to be approved at destructive level, whatever allow rules say.
    authorize: ({ method, path }) => ({
      toolName:
        method === "GET" ? "confluence_get_page" : "confluence_manage_page",
      // Placeholder page id only satisfies the direct tool's parameter schema;
      // the real target is the method and path in `summary`.
      args:
        method === "GET"
          ? { page_id: "raw-request" }
          : { action: "purge", page_id: "raw-request" },
      summary: `${method} ${String(path)}`,
      ...(method === "GET" ? {} : { approvalRequired: true as const }),
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body, query }, env) {
      return await confluenceRawRequest(await env.confluence(), {
        method,
        path,
        body,
        query,
        onBinary: artifactBinarySink(
          env,
          "confluence-response",
          (type) =>
            BINARY_EXTENSIONS[type.split(";")[0].trim().toLowerCase()] ??
            ".bin",
        ),
        signal: env.context.signal,
      });
    },
  }),
].map(withTidyErrors);

function usesAtlasDocFormat(body: unknown): boolean {
  const inner = (body as { body?: { representation?: unknown } } | null)?.body;
  return (
    (body as { representation?: unknown } | null)?.representation ===
      "atlas_doc_format" || inner?.representation === "atlas_doc_format"
  );
}

const BINARY_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
};

export function confluenceConnectionLoader(context: QuickScriptContext) {
  let connection: Promise<ConfluenceConnection> | undefined;
  return () =>
    (connection ??= orNotAvailable("confluence", () =>
      requireConfluenceConnection(context),
    ));
}

export function confluenceSpaceKeyLoader(
  context: QuickScriptContext,
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
      }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
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
