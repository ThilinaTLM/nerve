import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import {
  confluenceAttachmentRequest,
  confluenceRequest,
  pathSegment,
  requireConfluenceConnection,
} from "./client.js";
import {
  buildConfluenceTextResult,
  summarizeConfluenceAttachment,
  summarizeConfluenceComment,
  summarizeConfluenceLabel,
  summarizeConfluencePage,
  summarizeConfluenceRestrictions,
  valuesFromConfluenceList,
} from "./format.js";
import { optionalString, requiredString } from "./helpers.js";

function actionOf(args: Record<string, unknown>) {
  return requiredString(args.action, "action");
}
function kindPath(kind: string) {
  return kind === "inline" ? "inline-comments" : "footer-comments";
}
function dry(
  context: ToolExecutionContext,
  text: string,
  details: Record<string, unknown>,
) {
  return buildConfluenceTextResult({
    text: `Dry run: ${text}`,
    context,
    details: {
      ...details,
      operation: details.action,
      dryRun: true,
    },
  });
}

export async function executeConfluenceManageComment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const action = actionOf(args);
  const kind = requiredString(args.kind, "kind");
  const pageId =
    action === "create"
      ? requiredString(args.page_id, "page_id")
      : optionalString(args.page_id);
  const commentId = optionalString(args.comment_id);
  if (action !== "create" && !commentId)
    throw new ToolExecutionError(
      "CONFLUENCE_COMMENT_ID_REQUIRED",
      "comment_id is required.",
    );
  let current: Record<string, unknown> | undefined;
  if (commentId)
    current = await confluenceRequest<Record<string, unknown>>(connection, {
      path: `/${kindPath(kind)}/${pathSegment(commentId)}`,
      query: { "body-format": "storage" },
      signal: context.signal,
    });
  let payload: Record<string, unknown> | undefined;
  if (action === "create" || action === "update") {
    const body = requiredString(args.body, "body");
    const representation =
      optionalString(args.body_representation) ?? "storage";
    payload = { body: { representation, value: body } };
    if (pageId) payload.pageId = pageId;
    const parentId = optionalString(args.parent_comment_id);
    if (parentId) payload.parentCommentId = parentId;
    const properties = args.inline_properties;
    if (properties && typeof properties === "object")
      payload.properties = properties;
    if (action === "update")
      payload.version = {
        number:
          Number(
            (current?.version as { number?: number } | undefined)?.number ?? 1,
          ) + 1,
        message: optionalString(args.version_message),
      };
  } else if (action === "resolve" || action === "reopen") {
    if (kind !== "inline")
      throw new ToolExecutionError(
        "CONFLUENCE_INLINE_COMMENT_REQUIRED",
        "Only inline comments can be resolved or reopened.",
      );
    payload = {
      body:
        (current?.body as { storage?: unknown } | undefined)?.storage ??
        current?.body,
      resolutionStatus: action === "resolve" ? "resolved" : "open",
      version: {
        number:
          Number(
            (current?.version as { number?: number } | undefined)?.number ?? 1,
          ) + 1,
      },
    };
  }
  if (args.dry_run === true)
    return dry(
      context,
      `would ${action} ${kind} comment ${commentId ?? "on the selected page"}.`,
      {
        action,
        kind,
        commentId,
        pageId,
        payload,
      },
    );
  const path =
    action === "create"
      ? `/${kindPath(kind)}`
      : `/${kindPath(kind)}/${pathSegment(commentId ?? "")}`;
  const data = await confluenceRequest<Record<string, unknown>>(connection, {
    method:
      action === "create" ? "POST" : action === "delete" ? "DELETE" : "PUT",
    path,
    body: action === "delete" ? undefined : payload,
    signal: context.signal,
  });
  return buildConfluenceTextResult({
    text: `${past(action)} Confluence ${kind} comment ${data?.id ?? commentId ?? ""}.`,
    context,
    details: {
      action,
      operation: action,
      kind,
      commentId: data?.id ?? commentId,
      pageId: data?.pageId ?? pageId,
      comment:
        action === "delete"
          ? undefined
          : summarizeConfluenceComment(data, kind),
    },
  });
}

export async function executeConfluenceManagePage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const action = actionOf(args);
  const pageId = requiredString(args.page_id, "page_id");
  const page = await confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: {
      "body-format": "storage",
      "include-version": true,
      status:
        action === "restore" || action === "purge" ? "trashed" : "current",
    },
    signal: context.signal,
  });
  const currentStatus = optionalString(page.status);
  const expectedStatus =
    action === "restore" || action === "purge" ? "trashed" : "current";
  if (currentStatus !== expectedStatus) {
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_INVALID_STATE",
      `Page ${pageId} must be ${expectedStatus} to ${action}.`,
      { pageId, currentStatus, expectedStatus },
    );
  }
  if (args.dry_run === true)
    return dry(context, `would ${action} page ${pageId}.`, {
      action,
      pageId,
      currentStatus: page.status,
      page,
    });
  if (action === "trash" || action === "purge") {
    await confluenceRequest(connection, {
      method: "DELETE",
      path: `/pages/${pathSegment(pageId)}`,
      query: action === "purge" ? { purge: true } : undefined,
      signal: context.signal,
    });
  } else {
    const body = page.body as
      | { storage?: { value?: string; representation?: string } }
      | undefined;
    await confluenceRequest(connection, {
      method: "PUT",
      path: `/pages/${pathSegment(pageId)}`,
      body: {
        id: pageId,
        status: "current",
        title: page.title,
        body: {
          representation: body?.storage?.representation ?? "storage",
          value: body?.storage?.value ?? "",
        },
        version: {
          number:
            Number(
              (page.version as { number?: number } | undefined)?.number ?? 1,
            ) + 1,
          message: "Restored by Nerve",
        },
      },
      signal: context.signal,
    });
  }
  return buildConfluenceTextResult({
    text: `${past(action)} Confluence page ${pageId}.`,
    context,
    details: {
      action,
      operation: action,
      pageId,
      page: summarizeConfluencePage(page),
      previousStatus: optionalString(page.status),
      resultingStatus:
        action === "trash"
          ? "trashed"
          : action === "restore"
            ? "current"
            : "purged",
    },
  });
}

export async function executeConfluenceManageLabel(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const action = actionOf(args);
  const pageId = requiredString(args.page_id, "page_id");
  const label = requiredString(args.label, "label");
  const prefix = optionalString(args.prefix) ?? "global";
  if (args.dry_run === true)
    return dry(context, `would ${action} label '${label}' on page ${pageId}.`, {
      action,
      pageId,
      label,
      prefix,
    });
  if (action === "add")
    await confluenceRequest(connection, {
      api: "v1",
      method: "POST",
      path: `/content/${pathSegment(pageId)}/label`,
      body: [{ prefix, name: label }],
      signal: context.signal,
    });
  else
    await confluenceRequest(connection, {
      api: "v1",
      method: "DELETE",
      path: `/content/${pathSegment(pageId)}/label`,
      query: { name: label },
      signal: context.signal,
    });
  const labels = await confluenceRequest(connection, {
    api: "v1",
    path: `/content/${pathSegment(pageId)}/label`,
    query: { limit: 50 },
    signal: context.signal,
  });
  return buildConfluenceTextResult({
    text: `${past(action)} Confluence label '${label}' ${action === "add" ? "to" : "from"} page ${pageId}.`,
    context,
    details: {
      action,
      operation: action,
      pageId,
      label,
      prefix,
      labels: valuesFromConfluenceList(labels)
        .flatMap((value) => {
          const summary = summarizeConfluenceLabel(value);
          return summary ? [summary] : [];
        })
        .slice(0, 20),
      labelCount: valuesFromConfluenceList(labels).length,
    },
  });
}

export async function executeConfluenceManageRestriction(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireConfluenceConnection(context);
  const action = actionOf(args);
  const pageId = requiredString(args.page_id, "page_id");
  const operation = requiredString(args.operation, "operation");
  const current = await confluenceRequest(connection, {
    api: "v1",
    path: `/content/${pathSegment(pageId)}/restriction/byOperation`,
    signal: context.signal,
  });
  const subjectType = optionalString(args.subject_type);
  const subjectId = optionalString(args.subject_id);
  if (action !== "clear_operation" && (!subjectType || !subjectId))
    throw new ToolExecutionError(
      "CONFLUENCE_RESTRICTION_SUBJECT_REQUIRED",
      "subject_type and subject_id are required.",
    );
  if (args.dry_run === true)
    return dry(
      context,
      `would ${action.replaceAll("_", " ")} restriction on page ${pageId}.`,
      { action, pageId, operation, subjectType, subjectId, current },
    );
  if (action === "clear_operation") {
    await confluenceRequest(connection, {
      api: "v1",
      method: "DELETE",
      path: `/content/${pathSegment(pageId)}/restriction/byOperation/${pathSegment(operation)}`,
      signal: context.signal,
    });
  } else {
    const typePath = subjectType === "user" ? "user" : "group";
    const idQuery =
      subjectType === "user"
        ? { accountId: subjectId }
        : { groupId: subjectId };
    await confluenceRequest(connection, {
      api: "v1",
      method: action === "add" ? "PUT" : "DELETE",
      path: `/content/${pathSegment(pageId)}/restriction/byOperation/${pathSegment(operation)}/${typePath}`,
      query: idQuery,
      signal: context.signal,
    });
  }
  const restrictions = await confluenceRequest(connection, {
    api: "v1",
    path: `/content/${pathSegment(pageId)}/restriction/byOperation`,
    signal: context.signal,
  });
  return buildConfluenceTextResult({
    text: `Updated Confluence ${operation} restrictions on page ${pageId}.`,
    context,
    details: {
      action,
      operation: action,
      pageId,
      restrictionOperation: operation,
      subjectType,
      subjectId,
      restrictions: summarizeConfluenceRestrictions(restrictions),
      restrictionCount: summarizeConfluenceRestrictions(restrictions).length,
    },
  });
}

export async function executeConfluenceManageAttachment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const action = actionOf(args);
  const connection = await requireConfluenceConnection(context);
  if (action === "upload") {
    const pageId = requiredString(args.page_id, "page_id");
    const filePath = resolveToolPath(context.cwd, args.file_path);
    const filename = optionalString(args.filename) ?? basename(filePath);
    const bytes = await readFile(filePath);
    const maximum = 25 * 1024 * 1024;
    if (bytes.byteLength > maximum) {
      throw new ToolExecutionError(
        "CONFLUENCE_ATTACHMENT_TOO_LARGE",
        "Confluence attachment exceeds the 25 MiB upload limit.",
        { bytes: bytes.byteLength, maximum },
      );
    }
    if (args.dry_run === true) {
      return dry(context, `would upload ${filename} to page ${pageId}.`, {
        action,
        pageId,
        filePath,
        filename,
        bytes: bytes.byteLength,
      });
    }
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), filename);
    form.append("minorEdit", String(args.minor_edit !== false));
    const comment = optionalString(args.comment);
    if (comment) form.append("comment", comment);
    const data = await confluenceAttachmentRequest(connection, {
      method: args.update_existing === false ? "POST" : "PUT",
      pageId,
      form,
      query: { status: optionalString(args.status) },
      signal: context.signal,
    });
    const rawAttachment = valuesFromConfluenceList(data)[0] ?? data;
    const attachment = summarizeConfluenceAttachment(rawAttachment) ?? {
      filename,
    };
    return buildConfluenceTextResult({
      text: `Uploaded Confluence attachment ${filename} to page ${pageId}.`,
      context,
      details: {
        action,
        operation: action,
        pageId,
        attachment,
        filename,
        attachments: [attachment],
        attachmentCount: 1,
        displayedAttachmentCount: 1,
      },
    });
  }
  const pageId = requiredString(args.page_id, "page_id");
  const attachmentId = requiredString(args.attachment_id, "attachment_id");
  const attachment = await confluenceRequest<Record<string, unknown>>(
    connection,
    {
      path: `/attachments/${pathSegment(attachmentId)}`,
      query: { "include-version": true },
      signal: context.signal,
    },
  );
  if (args.dry_run === true)
    return dry(
      context,
      `would ${action} attachment ${attachmentId} on page ${pageId}.`,
      {
        action,
        pageId,
        attachmentId,
        attachment,
        newFilename: optionalString(args.new_filename),
      },
    );
  if (action === "delete")
    await confluenceRequest(connection, {
      method: "DELETE",
      path: `/attachments/${pathSegment(attachmentId)}`,
      signal: context.signal,
    });
  else {
    const newFilename = requiredString(args.new_filename, "new_filename");
    await confluenceRequest(connection, {
      api: "v1",
      method: "PUT",
      path: `/content/${pathSegment(attachmentId)}`,
      body: {
        id: attachmentId,
        type: "attachment",
        status: "current",
        title: newFilename,
        version: {
          number:
            Number(
              (attachment.version as { number?: number } | undefined)?.number ??
                1,
            ) + 1,
          message: optionalString(args.comment),
          minorEdit: args.minor_edit !== false,
        },
        container: { id: pageId, type: "page" },
      },
      signal: context.signal,
    });
  }
  return buildConfluenceTextResult({
    text: `${past(action)} Confluence attachment ${attachmentId} on page ${pageId}.`,
    context,
    details: {
      action,
      operation: action,
      pageId,
      attachmentId,
      attachment:
        action === "delete"
          ? undefined
          : summarizeConfluenceAttachment({
              ...attachment,
              title: args.new_filename,
            }),
      filename: action === "rename" ? args.new_filename : attachment.title,
      newFilename: action === "rename" ? args.new_filename : undefined,
    },
  });
}

function past(action: string) {
  if (action === "add") return "Added";
  if (action === "remove") return "Removed";
  if (action === "trash") return "Trashed";
  if (action === "restore") return "Restored";
  if (action === "purge") return "Purged";
  if (action === "create") return "Created";
  if (action === "update") return "Updated";
  if (action === "delete") return "Deleted";
  if (action === "rename") return "Renamed";
  if (action === "resolve") return "Resolved";
  if (action === "reopen") return "Reopened";
  return "Updated";
}
