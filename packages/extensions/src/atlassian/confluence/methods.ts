import { jsonObject } from "../shared/http.js";
import { confluenceRawRequest, confluenceRequest } from "./client.js";
import { pathSegment } from "../jira/client.js";
import { valuesFromConfluenceList } from "./format.js";
import { pageMarkdown } from "./page-read.js";
import { listSpaces, resolveSpace } from "./spaces.js";
import { rawMethod } from "../shared/raw-request.js";
import {
  attachmentReadAuthorizations,
  loadAttachment,
  parseAttachmentSpec,
} from "../shared/attachments.js";
import { confluenceAttachmentMethods } from "./attachments.js";
import { confluenceCommentMethods } from "./comment-methods.js";
import { confluenceExtraMethods } from "./extra-methods.js";
import {
  compactPage,
  confluencePageWriteMethods,
  pageUrl,
  uploadAttachment,
} from "./page-writes.js";
import { codedError, orWhenUnsupported } from "../shared/errors.js";
import { collectPages, limitNote } from "../shared/paging.js";
import { clampInt, nonEmptyString, optionalText } from "../shared/args.js";
import {
  defineMethod,
  definePositionalMethod,
  type PathedMethod,
} from "../shared/define-method.js";
import {
  confluencePage,
  confluenceSpace,
  rawRequest,
} from "../shared/targets.js";
import type { ConfluenceSession } from "./session.js";

const DEFAULT_PAGE_LIMIT = 50;
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

/**
 * Splits a trailing `ORDER BY ...` off a CQL query, so the filter can be put in
 * parentheses and ANDed with `space` and `title` while the ordering stays last.
 * Text inside quotes is not a clause.
 */
export function splitOrderBy(cql: string): {
  filter: string;
  orderBy: string | undefined;
} {
  let quote = "";
  let at = -1;
  for (let i = 0; i < cql.length; i += 1) {
    const char = cql[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (
      /^order\s+by\b/i.test(cql.slice(i)) &&
      !/\w/.test(cql[i - 1] ?? "")
    )
      at = i;
  }
  return at < 0
    ? { filter: cql.trim(), orderBy: undefined }
    : { filter: cql.slice(0, at).trim(), orderBy: cql.slice(at).trim() };
}

export const confluenceMethods: PathedMethod<ConfluenceSession>[] = [
  defineMethod({
    product: "confluence",
    path: "spaces.search",
    risk: "external_read",
    bare: "query",
    options: ["query"],
    signature:
      "/** Contains match on key or name. */ search(options?: string | { query?: string }): Promise<Space[]>",
    parse: (options) => optionalText(options.query)?.trim() ?? "",
    authorize: (query) => ({ targets: [], summary: query || "all spaces" }),
    resource: () => "Confluence spaces",
    async run(query, session) {
      const connection = session.connection;
      return (await listSpaces(session, query)).map((space) => ({
        ...space,
        type: space.type ?? null,
        url: `${connection.siteUrl}/wiki/spaces/${space.key}`,
      }));
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.search",
    risk: "external_read",
    bare: "cql",
    options: ["cql", "space", "title", "limit"],
    signature:
      "/** Needs cql, space or title (contains); ANDed. cql may end with ORDER BY. limit default 50, max 250. */ search(options: string | { cql?: string; space?: string; title?: string; limit?: number }): Promise<PageSummary[]>",
    parse: (options) => {
      const space = optionalText(options.space);
      const title = optionalText(options.title);
      const { filter: explicitCql, orderBy } = splitOrderBy(
        optionalText(options.cql) ?? "",
      );
      const parts = explicitCql ? [`(${explicitCql})`] : ["type = page"];
      if (space) parts.push(`space = "${escapeCql(space)}"`);
      if (title) parts.push(`title ~ "${escapeCql(title)}"`);
      if (parts.length === 1 && !explicitCql) {
        throw new Error("Provide at least one of cql, space or title.");
      }
      return {
        cql: parts.join(" AND ") + (orderBy ? ` ${orderBy}` : ""),
        limit: clampInt(options.limit, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
        space,
        title,
      };
    },
    authorize: ({ cql, space }) => ({
      targets: space ? [confluenceSpace(space)] : [],
      summary: cql,
    }),
    resource: () => "this Confluence search",
    async run({ cql, limit }, session, ctx) {
      const connection = session.connection;
      let start = 0;
      const { items, more } = await collectPages({
        limit,
        pageSize: 100,
        fetchPage: async ({ count }) => {
          const response = await confluenceRequest(connection, {
            api: "v1",
            parse: jsonObject,
            path: "/content/search",
            query: {
              cql,
              limit: count,
              start,
              expand: "space,version,ancestors",
            },
          });
          const results = valuesFromConfluenceList(response) as Array<
            Record<string, unknown>
          >;
          start += results.length;
          const links = response._links as { next?: unknown } | undefined;
          return {
            items: results.map((page) => {
              const ancestors = Array.isArray(page.ancestors)
                ? page.ancestors
                : [];
              return {
                id: String(page.id ?? ""),
                title: page.title ?? null,
                space:
                  (page.space as { key?: unknown } | undefined)?.key ?? null,
                url: pageUrl(connection, page),
                updated:
                  (page.version as { when?: unknown } | undefined)?.when ??
                  null,
                parentId:
                  (ancestors.at(-1) as { id?: unknown } | undefined)?.id ??
                  null,
              };
            }),
            more: Boolean(links?.next),
          };
        },
      });
      if (more) {
        ctx.report.note(
          limitNote(
            "confluence.pages.search",
            limit,
            MAX_PAGE_LIMIT,
            "pages",
            "the search",
          ),
        );
      }
      return items;
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.get",
    risk: "external_read",
    bare: "id",
    options: ["id", "space", "title", "body", "children"],
    signature:
      '/** By id or exact title (space defaults to the configured one). body "markdown" (default) is read-only (@Name, - [ ], [drawio macro: name] placeholders); to edit use "storage". */ get(options: string | ({ id: string } | { space?: string; title: string }) & { body?: "markdown" | "storage" | false; children?: boolean }): Promise<Page>',
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
    // By title there is no page id yet: the target is the space searched.
    authorize: ({ id, space, title }) => ({
      targets: id
        ? [confluencePage(id)]
        : space
          ? [confluenceSpace(space)]
          : [],
      summary: id ?? `${space ?? "default space"}/${title}`,
    }),
    resource: ({ id, title }) => (id ? `page ${id}` : `page "${title}"`),
    async run({ id, space, title, body, children }, session) {
      const connection = session.connection;
      let pageId = id;
      if (!pageId) {
        const { spaceId, spaceKey } = await resolveSpace(session, space);
        const found = await confluenceRequest(connection, {
          parse: jsonObject,
          path: "/pages",
          query: { "space-id": spaceId, title, limit: 1 },
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
      });
      const spaceId =
        page.spaceId === undefined ? undefined : String(page.spaceId);
      const keys = spaceId
        ? await session.spaceKeys([spaceId])
        : new Map<string, string>();
      const storage = (
        page.body as { storage?: { value?: unknown } } | undefined
      )?.storage?.value;
      const result: Record<string, unknown> = {
        ...compactPage(connection, page),
        space: (spaceId && keys.get(spaceId)) ?? spaceId ?? null,
        updated:
          (page.version as { createdAt?: unknown } | undefined)?.createdAt ??
          null,
        parentId: page.parentId ?? null,
        labels: labelNames(page.labels),
      };
      if (body !== false) {
        const xml = typeof storage === "string" ? storage : "";
        result.body =
          body === "storage" ? xml : await pageMarkdown(session, xml);
      }
      if (children) {
        const response = await confluenceRequest(connection, {
          path: `/pages/${pathSegment(pageId)}/direct-children`,
          query: { limit: 100 },
        }).catch(
          orWhenUnsupported(() =>
            confluenceRequest(connection, {
              path: `/pages/${pathSegment(pageId)}/children`,
              query: { limit: 100 },
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
    authorize: ({ id, spec }) => ({
      targets: [confluencePage(id)],
      summary: `${id} ← ${spec.filename ?? spec.file}`,
    }),
    authorizeAlso: ({ spec }) => attachmentReadAuthorizations([spec]),
    resource: ({ id }) => `page ${id}`,
    async run({ id, spec }, session) {
      return await uploadAttachment(
        session,
        id,
        await loadAttachment(spec, session),
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
    riskFromArgs: true,
    maxArgs: 4,
    signature:
      '/** Path under /wiki/api/v2/ or /wiki/rest/api/; binary returns a FileHandle. Page bodies: use pages.create/update. */ request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | boolean | string[]>): Promise<unknown>',
    parse: ([method, path, body, query]) => {
      const verb = rawMethod(method);
      if (verb !== "GET" && usesAtlasDocFormat(body)) {
        throw new Error(
          'atlas_doc_format bodies are not supported. Write pages with confluence.pages.create/update and storage.* (representation "storage").',
        );
      }
      return { method: verb, path, body, query };
    },
    // GET is an external read. Anything else cannot be analysed and counts as
    // destructive; a rule matching the method and path can still allow it.
    authorize: ({ method, path }) => ({
      risk: method === "GET" ? "external_read" : "destructive",
      targets: [rawRequest("confluence", `${method} ${String(path)}`)],
      summary: `${method} ${String(path)}`,
    }),
    resource: ({ path }) => String(path),
    async run({ method, path, body, query }, session) {
      return await confluenceRawRequest(session.connection, {
        method,
        path,
        body,
        query,
        binary: { base: "confluence-response" },
      });
    },
  }),
];

function usesAtlasDocFormat(body: unknown): boolean {
  const inner = (body as { body?: { representation?: unknown } } | null)?.body;
  return (
    (body as { representation?: unknown } | null)?.representation ===
      "atlas_doc_format" || inner?.representation === "atlas_doc_format"
  );
}
