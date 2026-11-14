import { jsonObject } from "../shared/http.js";
import { confluenceRequest } from "./client.js";
import { pathSegment } from "../jira/client.js";
import { valuesFromConfluenceList } from "./format.js";
import { assertWellFormedStorage } from "./storage-xml.js";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { codedError } from "@nervekit/tools/quick-script/runtime/errors";
import { nonEmptyString } from "@nervekit/tools/quick-script/runtime/sdk-args";
import {
  defineMethod,
  type MethodRisk,
  type SdkEnvironment,
  type SdkMethod,
} from "@nervekit/tools/quick-script/runtime/sdk-types";
import { pageUrl } from "./page-writes.js";
import { partialWriteFailure } from "./partial-write.js";
import { confluenceAttachment, confluencePage } from "../shared/targets.js";

const MAX_LIST_PAGES = 5;
const LABEL_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const LABEL_RULE =
  'labels are lowercase letters, digits, "-" and "_" (no ".", ":", "/" or other punctuation); spaces become "-"';

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
        `Invalid label "${label}"${bad.length ? ` (remove ${[...new Set(bad)].map((c) => `"${c}"`).join(" ")})` : ""}: ${LABEL_RULE}.`,
      );
    }
  }
  return [...new Set(labels)];
}

/**
 * Authorization that needs a lookup first (the page a comment or attachment
 * belongs to). `authorize` is synchronous and sees only the arguments, so these
 * methods authorize here, before their first write.
 */
export async function authorizeLookedUp(
  env: SdkEnvironment,
  check: { operation: string; targets: string[]; risk: MethodRisk },
): Promise<void> {
  if (!env.context.authorizeNested) {
    throw new Error(
      "Nested authorization is unavailable; refusing to run SDK calls.",
    );
  }
  await env.context.authorizeNested(check);
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

export const confluenceExtraMethods: SdkMethod[] = [
  defineMethod({
    product: "confluence",
    path: "attachments.list",
    risk: "network",
    bare: "id",
    options: ["id"],
    signature:
      "/** Of a page (id = page id). */ list(id: string | { id: string }): Promise<AttachmentInfo[]>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    authorize: ({ id }) => ({ targets: [confluencePage(id)], summary: id }),
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
      "/** id from attachments.list. */ delete(id: string | { id: string }): Promise<{ id: string }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    // The direct tool wants a page id: look the attachment's page up, then authorize.
    resource: ({ id }) => `attachment ${id}`,
    async run({ id }, env) {
      const connection = await env.confluence();
      const attachment = await confluenceRequest(connection, {
        parse: jsonObject,
        path: `/attachments/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      const pageId = attachment.pageId;
      if (pageId === undefined || pageId === null || pageId === "") {
        throw codedError(
          "NOT_FOUND",
          `Attachment ${id} is not on a page; it cannot be deleted from here.`,
        );
      }
      await authorizeLookedUp(env, {
        operation: "confluence.attachments.delete",
        targets: [confluenceAttachment(id), confluencePage(String(pageId))],
        risk: "destructive",
      });
      await confluenceRequest(connection, {
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
      '/** Labels are lowercase without spaces: case is folded and spaces become "-"; other punctuation (including ".") throws. */ add(options: { id: string; labels: string | string[] }): Promise<{ id: string; labels: string[] }>',
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      labels: normalizeLabels(options.labels),
    }),
    authorize: ({ id, labels }) => ({
      targets: [confluencePage(id)],
      summary: `${id} +${labels.join(",")}`,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, labels }, env) {
      try {
        await confluenceRequest(await env.confluence(), {
          api: "v1",
          method: "POST",
          path: `/content/${pathSegment(id)}/label`,
          body: labels.map((name) => ({ prefix: "global", name })),
          signal: env.context.signal,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("label.contains.invalid.chars")
        ) {
          throw new Error(
            `Invalid label in ${labels.map((l) => `"${l}"`).join(", ")}: ${LABEL_RULE}.`,
            { cause: error },
          );
        }
        throw error;
      }
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
    authorize: ({ id, labels }) => ({
      targets: [confluencePage(id)],
      summary: `${id} -${labels.join(",")}`,
    }),
    resource: ({ id }) => `page ${id}`,
    async run({ id, labels }, env) {
      const connection = await env.confluence();
      const current = await confluenceRequest(connection, {
        api: "v1",
        parse: jsonObject,
        path: `/content/${pathSegment(id)}/label`,
        signal: env.context.signal,
      });
      const have = (Array.isArray(current.results) ? current.results : [])
        .map((item) => String((item as { name?: unknown }).name ?? ""))
        .filter(Boolean);
      const absent = labels.filter((label) => !have.includes(label));
      if (absent.length > 0) {
        throw codedError(
          "NOT_FOUND",
          `Page ${id} has no label ${absent.map((l) => `"${l}"`).join(", ")}; nothing was removed. Current labels: ${have.join(", ") || "(none)"}.`,
        );
      }
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
            ? codedError("NOT_FOUND", `Page ${id} has no label "${label}".`)
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
    path: "pages.move",
    risk: "external_write",
    options: ["id", "parent", "before", "after"],
    signature:
      '/** One target: parent (last child), before or after (sibling id). Another space moves the page and children there. */ move(options: { id: string } & ({ parent: string } | { before: string } | { after: string })): Promise<{ id: string; position: "append" | "before" | "after"; target: string }>',
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
      targets: [confluencePage(id)],
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
      '/** Trashes the page (pages.restore undoes); purge: true deletes for good. */ delete(options: string | { id: string; purge?: boolean }): Promise<{ id: string; title: string | null; status: "trashed" | "purged" }>',
    parse: (options) => {
      if (options.purge !== undefined && typeof options.purge !== "boolean") {
        throw new Error("purge must be true or false.");
      }
      return {
        id: nonEmptyString(options.id, "id"),
        purge: options.purge === true,
      };
    },
    authorize: ({ id }) => ({
      targets: [confluencePage(id)],
      summary: id,
    }),
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
      "restore(id: string | { id: string }): Promise<{ id: string; title: string | null; url: string; version: number | null }>",
    parse: (options) => ({ id: nonEmptyString(options.id, "id") }),
    authorize: ({ id }) => ({
      targets: [confluencePage(id)],
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
