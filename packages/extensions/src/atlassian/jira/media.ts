import { jsonObject } from "../shared/http.js";
import { ACCOUNT_SETTING } from "../shared/transport.js";
import { type JiraConnection, jiraRequest, pathSegment } from "./client.js";
import type { AdfDocument } from "./adf.js";
import { isLocalImageTarget, markdownToAdf } from "./markdown-adf.js";
import { listValues } from "./field-values.js";
import type { JiraSession } from "./session.js";

export type IssueAttachment = {
  id: string;
  filename: string;
  size: number;
  mediaType: string;
  created: string | null;
  author: string | null;
};

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** The attachments of an issue, oldest first. */
export async function issueAttachments(
  session: JiraSession,
  key: string,
): Promise<IssueAttachment[]> {
  const issue = await jiraRequest(session.connection, {
    parse: jsonObject,
    path: `/issue/${pathSegment(key)}`,
    query: { fields: "attachment" },
  });
  const raw = (issue.fields as { attachment?: unknown } | undefined)
    ?.attachment;
  return (Array.isArray(raw) ? raw : [])
    .map((item): IssueAttachment => {
      const attachment = (item ?? {}) as Record<string, unknown>;
      const author = (attachment.author ?? {}) as Record<string, unknown>;
      return {
        id: String(attachment.id ?? ""),
        filename: String(attachment.filename ?? ""),
        size: typeof attachment.size === "number" ? attachment.size : 0,
        mediaType: String(attachment.mimeType ?? ""),
        created: text(attachment.created),
        author: text(author.displayName),
      };
    })
    .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
}

/**
 * The media file id Jira's ADF refers to. Attachment ids differ from it; it is
 * the UUID in the media URL the attachment's content URL redirects to. A HEAD
 * request follows the redirect without downloading the file, and the host
 * reports the final URL whatever the media host answers.
 */
async function mediaFileId(
  connection: JiraConnection,
  attachment: IssueAttachment,
): Promise<string> {
  const path = `/attachment/content/${pathSegment(attachment.id)}`;
  const response = await connection.ctx.http.request({
    url: `${connection.siteUrl}/rest/api/3${path}`,
    method: "HEAD",
    auth: { account: ACCOUNT_SETTING },
    response: "text",
  });
  const id = /\/file\/([0-9a-f-]{36})(?:\/|\?|$)/i.exec(response.url)?.[1];
  if (!id) {
    throw new Error(
      `Could not embed "${attachment.filename}": Jira gave no media id for attachment ${attachment.id} (HTTP ${response.status}).`,
    );
  }
  return id;
}

/** Image names a Markdown text refers to as `![alt](name)`; URLs are not attachments. */
function imageNames(markdown: string): string[] {
  const names = new Set<string>();
  markdownToAdf(markdown, (name) => {
    names.add(name);
    return undefined;
  });
  return [...names].filter(isLocalImageTarget);
}

export function hasLocalImages(markdown: string): boolean {
  return imageNames(markdown).length > 0;
}

/**
 * Markdown → ADF where `![alt](filename)` embeds the issue's attachment of
 * that name (the newest when names repeat) as a real image. Unknown or
 * non-image names fail with the attached files listed.
 */
export async function markdownDoc(
  session: JiraSession,
  key: string | undefined,
  markdown: string,
): Promise<AdfDocument> {
  const names = imageNames(markdown);
  if (names.length === 0) return markdownToAdf(markdown);
  if (!key) {
    throw new Error(
      `Images (${names.join(", ")}) can only be embedded in an existing issue: create it with attachments: [...] or upload first, then update.`,
    );
  }
  const attachments = await issueAttachments(session, key);
  const ids = new Map<string, string>();
  const connection = session.connection;
  await Promise.all(
    names.map(async (name) => {
      const match = attachments.filter((item) => item.filename === name).at(-1);
      if (!match) {
        throw new Error(
          `Image "${name}" is not an attachment of ${key}. Attached: ${listValues(attachments.map((item) => item.filename)) || "none"}. Upload it first with jira.attachments.upload, or pass attachments to issues.create.`,
        );
      }
      if (!match.mediaType.startsWith("image/")) {
        throw new Error(
          `"${name}" is ${match.mediaType || "not an image"}; only images can be embedded. Link to other files by name instead.`,
        );
      }
      ids.set(name, await mediaFileId(connection, match));
    }),
  );
  return markdownToAdf(markdown, (name) => ids.get(name));
}
