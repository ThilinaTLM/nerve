import { jsonObject } from "@nervekit/tools/integrations";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "@nervekit/tools/integrations";
import { valuesFromConfluenceList } from "@nervekit/tools/integrations";
import { storageXmlToMarkdown } from "@nervekit/tools/integrations";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { codedError } from "../../../runtime/errors.js";
import { nonEmptyString } from "../../../runtime/sdk-args.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../../../runtime/sdk-types.js";
import { authorizeLookedUp, storageBodyOption } from "./extra-methods.js";

const MAX_LIST_PAGES = 5;

type Json = Record<string, unknown>;

function commentArgs(
  action: string,
  kind: "footer" | "inline",
  fields: Json = {},
) {
  return { action, kind, ...fields };
}

function commentPageId(comment: Json): Json {
  return comment.pageId === undefined
    ? {}
    : { page_id: String(comment.pageId) };
}

type FoundComment = { kind: "footer" | "inline"; comment: Json };

/** Footer and inline comments have separate v2 endpoints; the id alone does not say which. */
async function findComment(
  env: SdkEnvironment,
  id: string,
): Promise<FoundComment> {
  const connection = await env.confluence();
  for (const kind of ["footer", "inline"] as const) {
    try {
      const comment = await confluenceRequest(connection, {
        parse: jsonObject,
        path: `/${kind}-comments/${pathSegment(id)}`,
        query: { "body-format": "storage" },
        signal: env.context.signal,
      });
      return { kind, comment };
    } catch (error) {
      if (
        !(error instanceof ToolExecutionError) ||
        error.code !== "CONFLUENCE_NOT_FOUND"
      )
        throw error;
    }
  }
  throw codedError(
    "NOT_FOUND",
    `No Confluence comment ${id}. Use confluence.comments.list(pageId) to find comment ids.`,
  );
}

function commentStorage(comment: Json): string {
  const body = comment.body as { storage?: { value?: unknown } } | undefined;
  return typeof body?.storage?.value === "string" ? body.storage.value : "";
}

function commentVersion(comment: Json): number {
  const number = (comment.version as { number?: unknown } | undefined)?.number;
  return typeof number === "number" ? number : 1;
}

async function listComments(
  connection: ConfluenceConnection,
  env: SdkEnvironment,
  pageId: string,
  want: { inline?: boolean; resolved?: boolean },
) {
  const found: Json[] = [];
  for (let start = 0, round = 0; round < MAX_LIST_PAGES * 5; round++) {
    const response = await confluenceRequest(connection, {
      api: "v1",
      parse: jsonObject,
      path: `/content/${pathSegment(pageId)}/child/comment`,
      query: {
        expand:
          "body.storage,history,extensions.inlineProperties,extensions.resolution,ancestors",
        depth: "all",
        limit: 100,
        start,
      },
      signal: env.context.signal,
    });
    const batch = valuesFromConfluenceList(response) as Json[];
    found.push(...batch);
    start += batch.length;
    if (batch.length < 100) break;
  }
  const comments = [];
  for (const raw of found) {
    const extensions = (raw.extensions ?? {}) as {
      location?: unknown;
      inlineProperties?: { originalSelection?: unknown };
      resolution?: { status?: unknown };
    };
    const isInline = extensions.location === "inline";
    const resolved = extensions.resolution?.status === "resolved";
    if (want.inline === true && !isInline) continue;
    if (want.inline === false && isInline) continue;
    if (
      want.resolved !== undefined &&
      (!isInline || resolved !== want.resolved)
    )
      continue;
    const history = (raw.history ?? {}) as {
      createdDate?: unknown;
      createdBy?: { displayName?: unknown; publicName?: unknown };
    };
    const ancestors = (Array.isArray(raw.ancestors) ? raw.ancestors : []) as {
      id?: unknown;
      type?: unknown;
    }[];
    const parent = ancestors.filter((a) => a.type === "comment").at(-1);
    comments.push({
      id: String(raw.id ?? ""),
      author:
        (history.createdBy?.displayName as string | undefined) ??
        (history.createdBy?.publicName as string | undefined) ??
        null,
      created: (history.createdDate as string | undefined) ?? null,
      body: await storageXmlToMarkdown(commentStorage(raw), env.context.signal),
      parentId: parent?.id === undefined ? null : String(parent.id),
      ...(isInline
        ? {
            inline: {
              selection:
                (extensions.inlineProperties?.originalSelection as
                  | string
                  | undefined) ?? "",
              resolved,
            },
          }
        : {}),
    });
  }
  return comments;
}

type InlineTarget = { text: string; occurrence?: number };

function inlineRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("inline must be { text, occurrence? }.");
  }
  return Object.fromEntries(Object.entries(value));
}

function parseInline(value: unknown): InlineTarget | undefined {
  if (value === undefined) return undefined;
  const inline = inlineRecord(value);
  const text = nonEmptyString(inline.text, "inline.text");
  const { occurrence } = inline;
  if (
    occurrence !== undefined &&
    (typeof occurrence !== "number" ||
      !Number.isInteger(occurrence) ||
      occurrence < 1)
  ) {
    throw new Error("inline.occurrence must be a positive integer (1-based).");
  }
  return { text, ...(occurrence === undefined ? {} : { occurrence }) };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Removes tags until none are left, so nested fragments cannot reassemble one. */
function stripTags(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replaceAll(/<[^<>]*>/g, "");
  } while (current !== previous);
  return current.replaceAll(/[<>]/g, "");
}

/** The page's visible text as Confluence matches it: tags dropped, entities decoded, whitespace collapsed. */
function storageText(storage: string): string {
  return stripTags(
    storage.replaceAll(
      /<\/(?:p|li|h[1-6]|tr|div|ac:task-body)>|<br\s*\/?>/gi,
      "\n",
    ),
  )
    .replaceAll(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1].toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    })
    .replaceAll(/[^\S\n]+/g, " ");
}

function resolveInlineSelection(storage: string, inline: InlineTarget) {
  const page = storageText(storage);
  const needle = inline.text.replaceAll(/\s+/g, " ");
  let count = 0;
  for (
    let at = page.indexOf(needle);
    at >= 0;
    at = page.indexOf(needle, at + 1)
  )
    count++;
  if (count === 0) {
    throw codedError(
      "NOT_FOUND",
      `Text "${inline.text}" was not found in the page's rendered text. Use a shorter exact phrase from one paragraph (no Markdown syntax).`,
    );
  }
  if (inline.occurrence === undefined && count > 1) {
    throw codedError(
      "BAD_REQUEST",
      `Text "${inline.text}" appears ${count} times; pass inline.occurrence (1-based, 1-${count}) to pick one, or a longer phrase.`,
    );
  }
  const occurrence = inline.occurrence ?? 1;
  if (occurrence > count) {
    throw codedError(
      "BAD_REQUEST",
      `inline.occurrence ${occurrence} is out of range: "${inline.text}" appears ${count} time${count === 1 ? "" : "s"}.`,
    );
  }
  return {
    textSelection: inline.text,
    textSelectionMatchCount: count,
    textSelectionMatchIndex: occurrence - 1,
  };
}

export const confluenceCommentMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "comments.list",
    risk: "network",
    bare: "id",
    options: ["id", "inline", "resolved"],
    signature:
      "/** Footer and inline comments incl. replies (parentId). inline: true/false limits to one kind; resolved filters inline. */ list(options: string | { id: string; inline?: boolean; resolved?: boolean }): Promise<ConfluenceComment[]>",
    parse: (options) => {
      for (const key of ["inline", "resolved"]) {
        const value = options[key];
        if (value !== undefined && typeof value !== "boolean") {
          throw new Error(`${key} must be true or false.`);
        }
      }
      if (options.inline === false && options.resolved !== undefined) {
        throw new Error(
          "resolved applies to inline comments; drop inline: false.",
        );
      }
      return {
        id: nonEmptyString(options.id, "id (page id)"),
        inline: options.inline as boolean | undefined,
        resolved: options.resolved as boolean | undefined,
      };
    },
    authorize: ({ id }) => ({
      toolName: "confluence_get_page",
      args: { page_id: id },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, inline, resolved }, env) {
      return await listComments(await env.confluence(), env, id, {
        inline,
        resolved,
      });
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.add",
    risk: "external_write",
    options: ["id", "body", "inline"],
    signature:
      "/** Footer comment, or with inline: { text, occurrence? } anchored to exact rendered page text (1-based occurrence, required if text repeats). */ add(options: { id: string; body: RichText; inline?: { text: string; occurrence?: number } }): Promise<{ id: string; pageId: string }>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      body: storageBodyOption(options),
      inline: parseInline(options.inline),
    }),
    authorize: ({ id, body, inline }) => ({
      toolName: "confluence_manage_comment",
      args: {
        action: "create",
        kind: inline ? "inline" : "footer",
        page_id: id,
        body,
      },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, body, inline }, env) {
      const connection = await env.confluence();
      let request: { path: string; body: Json };
      if (inline) {
        const page = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/pages/${pathSegment(id)}`,
          query: { "body-format": "storage" },
          signal: env.context.signal,
        });
        const storage = (page.body as { storage?: { value?: unknown } })
          ?.storage?.value;
        const selection = resolveInlineSelection(
          typeof storage === "string" ? storage : "",
          inline,
        );
        request = {
          path: "/inline-comments",
          body: {
            pageId: id,
            body: { representation: "storage", value: body },
            inlineCommentProperties: selection,
          },
        };
      } else {
        request = {
          path: "/footer-comments",
          body: {
            pageId: id,
            body: { representation: "storage", value: body },
          },
        };
      }
      const created = await confluenceRequest(connection, {
        parse: jsonObject,
        method: "POST",
        path: request.path,
        body: request.body,
        signal: env.context.signal,
      });
      const commentId = String(created.id ?? "");
      env.report.created.push(`confluence comment ${commentId}`);
      return { id: commentId, pageId: id };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.update",
    risk: "external_write",
    options: ["id", "body"],
    signature: `update(options: { id: string; body: RichText }): Promise<{ id: string }>`,
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      body: storageBodyOption(options),
    }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id, body }, env) {
      const { kind, comment } = await findComment(env, id);
      await authorizeLookedUp(
        env,
        "confluence_manage_comment",
        commentArgs("update", kind, {
          comment_id: id,
          ...commentPageId(comment),
          body,
        }),
      );
      await confluenceRequest(await env.confluence(), {
        method: "PUT",
        path: `/${kind}-comments/${pathSegment(id)}`,
        body: {
          version: { number: commentVersion(comment) + 1 },
          body: { representation: "storage", value: body },
        },
        signal: env.context.signal,
      });
      env.report.updated.push(`confluence comment ${id}`);
      return { id };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.delete",
    risk: "destructive",
    bare: "id",
    options: ["id"],
    signature:
      "/** Also deletes replies. */ delete(id: string | { id: string }): Promise<{ id: string }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id }, env) {
      const { kind, comment } = await findComment(env, id);
      await authorizeLookedUp(
        env,
        "confluence_manage_comment",
        commentArgs("delete", kind, {
          comment_id: id,
          ...commentPageId(comment),
        }),
      );
      await confluenceRequest(await env.confluence(), {
        method: "DELETE",
        path: `/${kind}-comments/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      env.report.deleted.push(`confluence comment ${id}`);
      return { id };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.reply",
    risk: "external_write",
    options: ["id", "body"],
    signature: `/** id is the parent comment. */ reply(options: { id: string; body: RichText }): Promise<{ id: string; parentId: string }>`,
    parse: (options) => ({
      id: nonEmptyString(options.id, "id (parent comment id)"),
      body: storageBodyOption(options),
    }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id, body }, env) {
      const { kind, comment } = await findComment(env, id);
      await authorizeLookedUp(
        env,
        "confluence_manage_comment",
        commentArgs("create", kind, {
          parent_comment_id: id,
          ...commentPageId(comment),
          body,
        }),
      );
      const created = await confluenceRequest(await env.confluence(), {
        parse: jsonObject,
        method: "POST",
        path: `/${kind}-comments`,
        body: {
          parentCommentId: id,
          body: { representation: "storage", value: body },
        },
        signal: env.context.signal,
      });
      const replyId = String(created.id ?? "");
      env.report.created.push(`confluence comment ${replyId}`);
      return { id: replyId, parentId: id };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.resolve",
    risk: "external_write",
    options: ["id", "resolved"],
    signature:
      "/** Resolves (default) or reopens an inline comment. */ resolve(options: { id: string; resolved?: boolean }): Promise<{ id: string; resolved: boolean }>",
    parse: (options) => {
      if (
        options.resolved !== undefined &&
        typeof options.resolved !== "boolean"
      ) {
        throw new Error("resolved must be true or false.");
      }
      return {
        id: nonEmptyString(options.id, "id"),
        resolved: options.resolved !== false,
      };
    },
    resource: ({ id }) => `comment ${id}`,
    async run({ id, resolved }, env) {
      const connection = await env.confluence();
      let comment: Json;
      try {
        comment = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/inline-comments/${pathSegment(id)}`,
          query: { "body-format": "storage" },
          signal: env.context.signal,
        });
      } catch (error) {
        if (
          error instanceof ToolExecutionError &&
          error.code === "CONFLUENCE_NOT_FOUND"
        ) {
          throw codedError(
            "NOT_FOUND",
            `No inline comment ${id}; only inline comments can be resolved (footer comments have no resolution). Use confluence.comments.list({ id: pageId, inline: true }).`,
          );
        }
        throw error;
      }
      await authorizeLookedUp(
        env,
        "confluence_manage_comment",
        commentArgs(resolved ? "resolve" : "reopen", "inline", {
          comment_id: id,
          ...commentPageId(comment),
        }),
      );
      await confluenceRequest(connection, {
        method: "PUT",
        path: `/inline-comments/${pathSegment(id)}`,
        body: {
          version: { number: commentVersion(comment) + 1 },
          body: { representation: "storage", value: commentStorage(comment) },
          resolved,
        },
        signal: env.context.signal,
      });
      env.report.updated.push(`confluence comment ${id}`);
      return { id, resolved };
    },
  }),
];
