import { jsonObject } from "../../atlassian/http.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "../../confluence/client.js";
import { valuesFromConfluenceList } from "../../confluence/format.js";
import { storageXmlToMarkdown } from "../../confluence/markdown.js";
import { assertWellFormedStorage } from "../../confluence/storage-xml.js";
import { ToolExecutionError } from "../../errors/tool-error.js";
import { codedError } from "../errors.js";
import { nonEmptyString } from "../sdk-args.js";
import {
  defineMethod,
  type NestedAuthorization,
  type SdkEnvironment,
  type SdkMethod,
} from "../sdk-types.js";
import { pageUrl } from "./page-writes.js";
import { partialWriteFailure } from "./partial-write.js";

const MAX_LIST_PAGES = 5;
const LABEL_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

type Json = Record<string, unknown>;

function nextCursor(response: Json): string | undefined {
  const next = (response._links as { next?: unknown } | undefined)?.next;
  return typeof next === "string"
    ? (new URL(next, "https://example.invalid").searchParams.get("cursor") ??
        undefined)
    : undefined;
}

/**
 * Confluence labels are lowercase with no spaces. Spaces become "-" and case is
 * folded so `"Q4 Plan"` works; anything else the API rejects fails here with the fix.
 */
export function normalizeLabels(value: unknown): string[] {
  const labels = (Array.isArray(value) ? value : [value])
    .map((label) => (typeof label === "string" ? label.trim() : ""))
    .filter(Boolean)
    .map((label) => label.toLowerCase().replace(/\s+/g, "-"));
  if (labels.length === 0) {
    throw new Error("labels must be a non-empty string or array of strings.");
  }
  for (const label of labels) {
    if (label.length > 255 || !LABEL_PATTERN.test(label)) {
      const bad = [...label].filter((c) => !LABEL_PATTERN.test(c));
      throw new Error(
        `Invalid label "${label}"${bad.length ? ` (remove ${[...new Set(bad)].map((c) => `"${c}"`).join(" ")})` : ""}: labels are lowercase letters, digits, "-", "_" and "."; spaces become "-".`,
      );
    }
  }
  return [...new Set(labels)];
}

const labelChecks = (
  action: "add" | "remove",
  id: string,
  labels: string[],
): NestedAuthorization[] =>
  labels.map((label) => ({
    toolName: "confluence_manage_label",
    args: { action, page_id: id, label, prefix: "global" },
    summary: `${id} ${action === "add" ? "+" : "-"}${labels.join(",")}`,
  }));

function commentArgs(
  action: string,
  kind: "footer" | "inline",
  fields: Json = {},
) {
  return { action, kind, ...fields };
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

/** The sandbox converts RichText to storage XHTML before the call; the host only checks it is well-formed storage. */
export function storageBodyOption(options: Json): string {
  const body = options.body;
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("body must be a non-empty RichText.");
  }
  assertWellFormedStorage(body);
  return body;
}

const BODY_DOC = "body is RichText.";

export const confluenceExtraMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "attachments.list",
    risk: "network",
    bare: "id",
    options: ["id"],
    signature:
      "/** Attachments of a page (id = page id). Upload with the same filename = new version. */ list(id: string | { id: string }): Promise<AttachmentInfo[]>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    authorize: ({ id }) => ({
      toolName: "confluence_get_page",
      args: { page_id: id },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id }, env) {
      const connection = await env.confluence();
      const items: Json[] = [];
      let cursor: string | undefined;
      for (let round = 0; round < MAX_LIST_PAGES; round++) {
        const response = await confluenceRequest(connection, {
          parse: jsonObject,
          path: `/pages/${pathSegment(id)}/attachments`,
          query: { limit: 250, cursor },
          signal: env.context.signal,
        });
        items.push(...(valuesFromConfluenceList(response) as Json[]));
        cursor = nextCursor(response);
        if (!cursor) break;
      }
      return items.map((item) => ({
        id: String(item.id ?? ""),
        filename: String(item.title ?? ""),
        size: Number(item.fileSize ?? 0),
        mediaType: String(item.mediaType ?? ""),
        version: Number((item.version as Json | undefined)?.number ?? 1),
        ...(typeof item.comment === "string" && item.comment
          ? { comment: item.comment }
          : {}),
      }));
    },
  }),
  defineMethod({
    product: "confluence",
    path: "attachments.delete",
    risk: "destructive",
    bare: "id",
    options: ["id"],
    signature:
      "/** Deletes an attachment (id from attachments.list). */ delete(id: string | { id: string }): Promise<{ id: string }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    // The direct tool wants a page id; an attachment id alone does not give one.
    authorize: ({ id }) => ({
      toolName: "confluence_manage_attachment",
      args: { action: "delete", page_id: "(attachment)", attachment_id: id },
      summary: `attachment ${id}`,
    }),
    resource: ({ id }) => `attachment ${id}`,
    async run({ id }, env) {
      await confluenceRequest(await env.confluence(), {
        method: "DELETE",
        path: `/attachments/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      env.report.deleted.push(`attachment ${id}`);
      return { id };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "labels.add",
    risk: "external_write",
    options: ["id", "labels"],
    signature:
      '/** Labels are lowercase without spaces: case is folded and spaces become "-"; other punctuation throws. */ add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>',
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      labels: normalizeLabels(options.labels),
    }),
    authorize: ({ id, labels }) => labelChecks("add", id, labels)[0],
    authorizeAlso: ({ id, labels }) => labelChecks("add", id, labels).slice(1),
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
    path: "labels.remove",
    risk: "external_write",
    options: ["id", "labels"],
    signature:
      "remove(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      labels: normalizeLabels(options.labels),
    }),
    authorize: ({ id, labels }) => labelChecks("remove", id, labels)[0],
    authorizeAlso: ({ id, labels }) =>
      labelChecks("remove", id, labels).slice(1),
    resource: ({ id }) => `page ${id}`,
    async run({ id, labels }, env) {
      const connection = await env.confluence();
      const done: string[] = [];
      for (const label of labels) {
        try {
          await confluenceRequest(connection, {
            api: "v1",
            method: "DELETE",
            path: `/content/${pathSegment(id)}/label`,
            query: { name: label },
            signal: env.context.signal,
          });
          done.push(label);
        } catch (error) {
          const missing =
            error instanceof ToolExecutionError &&
            error.code === "CONFLUENCE_NOT_FOUND";
          const reason = missing
            ? codedError(
                "NOT_FOUND",
                `Page ${id} has no label "${label}". Current labels: confluence.pages.get({ id, body: false }).labels.`,
              )
            : error;
          throw done.length
            ? partialWriteFailure(reason, `already removed: ${done.join(", ")}`)
            : reason;
        }
      }
      return { id, labels };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "comments.list",
    risk: "network",
    bare: "id",
    options: ["id", "inline", "resolved"],
    signature:
      "/** Footer and inline comments of a page, replies included (parentId). inline: true/false limits to one kind; resolved filters inline comments only. */ list(options: string | { id: string; inline?: boolean; resolved?: boolean }): Promise<ConfluenceComment[]>",
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
    path: "comments.update",
    risk: "external_write",
    options: ["id", "body"],
    signature: `/** Replaces a footer or inline comment's text. ${BODY_DOC} */ update(options: { id: string; body: RichText }): Promise<{ id: string }>`,
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      body: storageBodyOption(options),
    }),
    authorize: ({ id, body }) => ({
      toolName: "confluence_manage_comment",
      args: commentArgs("update", "footer", { comment_id: id, body }),
      summary: id,
    }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id, body }, env) {
      const { kind, comment } = await findComment(env, id);
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
      "/** Deletes a footer or inline comment and its replies. */ delete(id: string | { id: string }): Promise<{ id: string }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    authorize: ({ id }) => ({
      toolName: "confluence_manage_comment",
      args: commentArgs("delete", "footer", { comment_id: id }),
      summary: id,
    }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id }, env) {
      const { kind } = await findComment(env, id);
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
    signature: `/** Replies to a footer or inline comment (id = parent comment id). ${BODY_DOC} */ reply(options: { id: string; body: RichText }): Promise<{ id: string; parentId: string }>`,
    parse: (options) => ({
      id: nonEmptyString(options.id, "id (parent comment id)"),
      body: storageBodyOption(options),
    }),
    authorize: ({ id, body }) => ({
      toolName: "confluence_manage_comment",
      args: commentArgs("create", "footer", {
        parent_comment_id: id,
        body,
      }),
      summary: `reply to ${id}`,
    }),
    resource: ({ id }) => `comment ${id}`,
    async run({ id, body }, env) {
      const { kind } = await findComment(env, id);
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
    authorize: ({ id, resolved }) => ({
      toolName: "confluence_manage_comment",
      args: commentArgs(resolved ? "resolve" : "reopen", "inline", {
        comment_id: id,
      }),
      summary: id,
    }),
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
  defineMethod({
    product: "confluence",
    path: "pages.move",
    risk: "external_write",
    options: ["id", "parent", "before", "after"],
    signature:
      '/** Give exactly one target: parent (becomes its last child), before or after (a sibling page id). A target in another space moves the page there, with its children. */ move(options: { id: string; parent: string } | { id: string; before: string } | { id: string; after: string }): Promise<{ id: string; position: "append" | "before" | "after"; target: string }>',
    parse: (options) => {
      const given = (["parent", "before", "after"] as const).filter(
        (key) => options[key] !== undefined,
      );
      if (given.length !== 1) {
        throw new Error(
          "Give exactly one of parent (move under it), before or after (a sibling page id).",
        );
      }
      const key = given[0];
      return {
        id: nonEmptyString(options.id, "id"),
        position: key === "parent" ? ("append" as const) : key,
        target: nonEmptyString(options[key], key),
      };
    },
    authorize: ({ id }) => ({
      toolName: "confluence_update_page",
      args: { page_id: id },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, position, target }, env) {
      await confluenceRequest(await env.confluence(), {
        api: "v1",
        method: "PUT",
        path: `/content/${pathSegment(id)}/move/${position}/${pathSegment(target)}`,
        signal: env.context.signal,
      });
      env.report.updated.push(`page ${id} moved (${position} ${target})`);
      return { id, position, target };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.delete",
    risk: "destructive",
    bare: "id",
    options: ["id", "purge"],
    signature:
      '/** Moves the page to the trash (restorable with pages.restore); purge: true deletes it for good. */ delete(options: string | { id: string; purge?: boolean }): Promise<{ id: string; title: string | null; status: "trashed" | "purged" }>',
    parse: (options) => {
      if (options.purge !== undefined && typeof options.purge !== "boolean") {
        throw new Error("purge must be true or false.");
      }
      return {
        id: nonEmptyString(options.id, "id"),
        purge: options.purge === true,
      };
    },
    authorize: ({ id, purge }) => ({
      toolName: "confluence_manage_page",
      args: { action: purge ? "purge" : "trash", page_id: id },
      summary: id,
    }),
    authorizeAlso: ({ id, purge }) =>
      purge
        ? [
            {
              toolName: "confluence_manage_page",
              args: { action: "trash", page_id: id },
              summary: id,
            },
          ]
        : [],
    resource: ({ id }) => `page ${id}`,
    async run({ id, purge }, env) {
      const connection = await env.confluence();
      const page = await confluenceRequest(connection, {
        parse: jsonObject,
        path: `/pages/${pathSegment(id)}`,
        query: { status: ["current", "trashed"] },
        signal: env.context.signal,
      });
      const title = typeof page.title === "string" ? page.title : null;
      if (page.status !== "trashed") {
        await confluenceRequest(connection, {
          method: "DELETE",
          path: `/pages/${pathSegment(id)}`,
          signal: env.context.signal,
        });
      }
      if (purge) {
        try {
          await confluenceRequest(connection, {
            method: "DELETE",
            path: `/pages/${pathSegment(id)}`,
            query: { purge: true },
            signal: env.context.signal,
          });
        } catch (error) {
          throw partialWriteFailure(
            error,
            `page ${id} is in the trash; retry confluence.pages.delete({ id, purge: true })`,
          );
        }
      }
      env.report.deleted.push(
        `page ${id}${title ? ` "${title}"` : ""}${purge ? " (purged)" : " (trashed)"}`,
      );
      return { id, title, status: purge ? "purged" : "trashed" };
    },
  }),
  defineMethod({
    product: "confluence",
    path: "pages.restore",
    risk: "external_write",
    bare: "id",
    options: ["id"],
    signature:
      "/** Restores a trashed page (its content is kept). */ restore(id: string | { id: string }): Promise<{ id: string; title: string | null; url: string; version: number | null }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    authorize: ({ id }) => ({
      toolName: "confluence_manage_page",
      args: { action: "restore", page_id: id },
      summary: id,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id }, env) {
      const connection = await env.confluence();
      const page = await confluenceRequest(connection, {
        parse: jsonObject,
        path: `/pages/${pathSegment(id)}`,
        query: { status: "trashed", "body-format": "storage" },
        signal: env.context.signal,
      });
      if (page.status !== "trashed") {
        throw new Error(
          `Page ${id} is not in the trash (status ${String(page.status)}).`,
        );
      }
      const version =
        (page.version as { number?: number } | undefined)?.number ?? 1;
      const restored = await confluenceRequest(connection, {
        parse: jsonObject,
        method: "PUT",
        path: `/pages/${pathSegment(id)}`,
        body: {
          id,
          status: "current",
          title: page.title,
          body: {
            representation: "storage",
            value:
              (page.body as { storage?: { value?: string } } | undefined)
                ?.storage?.value ?? "",
          },
          version: { number: version + 1, message: "Restored" },
        },
        signal: env.context.signal,
      });
      const title = typeof page.title === "string" ? page.title : null;
      env.report.updated.push(
        `page ${id}${title ? ` "${title}"` : ""} restored`,
      );
      return {
        id,
        title,
        url: pageUrl(connection, { ...restored, id }),
        version:
          (restored.version as { number?: number } | undefined)?.number ??
          version + 1,
      };
    },
  }),
];
