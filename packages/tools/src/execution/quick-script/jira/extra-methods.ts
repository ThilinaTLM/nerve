import { extname } from "node:path";
import { jsonObject } from "../../atlassian/http.js";
import { ToolExecutionError } from "../../errors/tool-error.js";
import {
  type JiraConnection,
  jiraDownload,
  jiraRequest,
  pathSegment,
} from "../../jira/client.js";
import { adfToMarkdown } from "../../jira/adf-markdown.js";
import { markdownToAdf } from "../../jira/markdown-adf.js";
import {
  assertArtifactName,
  freshArtifactName,
  MAX_FILE_BYTES,
  writeArtifact,
} from "../files/artifacts.js";
import { codedError } from "../errors.js";
import { nonEmptyString } from "../sdk-args.js";
import {
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../sdk-types.js";

const MAX_PROJECTS = 1000;
const PROJECT_PAGE_SIZE = 50;

/** The current user, shared with `atlassian.defaults()`. */
export async function fetchJiraMe(
  env: SdkEnvironment,
  connection?: JiraConnection,
) {
  const me = await jiraRequest(connection ?? (await env.jira()), {
    parse: jsonObject,
    path: "/myself",
    signal: env.context.signal,
  });
  return {
    accountId: String(me.accountId ?? ""),
    name: String(me.displayName ?? ""),
    email: typeof me.emailAddress === "string" ? me.emailAddress : null,
    timeZone: typeof me.timeZone === "string" ? me.timeZone : null,
  };
}

/** `jira.request` onBinary: saves a binary response as an artifact named after the path's file extension. */
export function rawBinarySaver(env: SdkEnvironment, path: unknown) {
  const extension = extname(String(path).split("?")[0] ?? "") || ".bin";
  return async (bytes: Uint8Array) =>
    await writeArtifact(
      env,
      await freshArtifactName(env, "response", extension),
      bytes,
    );
}

/** A safe artifact name from an attachment's own file name. */
function artifactNameFor(filename: string): string {
  const clean = filename
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._-]+/, "")
    .slice(-100);
  return clean || "attachment";
}

export const jiraExtraMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "attachments.download",
    risk: "read",
    bare: "id",
    options: ["id", "name"],
    signature:
      "/** Saves the attachment as `artifact:<its filename>` (or `name`); max 20 MB. */ download(options: string | { id: string; name?: string }): Promise<FileHandle>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      name:
        options.name === undefined
          ? undefined
          : assertArtifactName(options.name),
    }),
    authorize: ({ id }) => ({
      toolName: "jira_download_attachment",
      args: { attachment_id: id },
      summary: `attachment ${id}`,
    }),
    resource: ({ id }) => `attachment ${id}`,
    async run({ id, name }, env) {
      const connection = await env.jira();
      const meta = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/attachment/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      const tooBig = (size: number) =>
        codedError(
          "BAD_REQUEST",
          `Attachment ${id} is ${size} bytes; downloads are limited to ${MAX_FILE_BYTES}. Fetch it outside quick_script.`,
        );
      if (typeof meta.size === "number" && meta.size > MAX_FILE_BYTES) {
        throw tooBig(meta.size);
      }
      const downloaded = await jiraDownload(
        connection,
        id,
        env.context.signal,
      ).catch((error: unknown) => {
        if (
          error instanceof ToolExecutionError &&
          error.code === "JIRA_ATTACHMENT_TOO_LARGE"
        ) {
          throw tooBig(Number(error.details?.bytes ?? 0));
        }
        throw error;
      });
      if (downloaded.bytes.byteLength > MAX_FILE_BYTES) {
        throw tooBig(downloaded.bytes.byteLength);
      }
      const filename = artifactNameFor(
        String(meta.filename ?? downloaded.filename ?? `attachment-${id}`),
      );
      let target = name;
      if (!target) {
        const extension = extname(filename);
        target = await freshArtifactName(
          env,
          filename.slice(0, filename.length - extension.length),
          extension,
        );
      }
      return await writeArtifact(env, target, downloaded.bytes);
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.delete",
    risk: "destructive",
    bare: "key",
    options: ["key", "subtasks"],
    signature:
      "/** Permanently deletes the issue; `subtasks: true` also deletes its subtasks (required if it has any). */ delete(options: string | { key: string; subtasks?: boolean }): Promise<{ key: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      subtasks: options.subtasks === true,
    }),
    // No direct tool deletes issues: like a raw non-GET request, the deny
    // rules of a delete tool apply and the call always needs approval.
    authorize: ({ key }) => ({
      toolName: "jira_manage_comment",
      args: { action: "delete", issue_key: "raw-request", comment_id: "-" },
      summary: `DELETE issue ${key}`,
      approvalRequired: true as const,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, subtasks }, env) {
      try {
        await jiraRequest(await env.jira(), {
          method: "DELETE",
          path: `/issue/${pathSegment(key)}`,
          query: { deleteSubtasks: subtasks },
          signal: env.context.signal,
        });
      } catch (error) {
        if (
          !subtasks &&
          error instanceof ToolExecutionError &&
          error.code === "JIRA_BAD_REQUEST"
        ) {
          throw codedError(
            "BAD_REQUEST",
            `${key} was not deleted, probably because it has subtasks: pass { key: "${key}", subtasks: true } to delete them too. ${error.message}`,
          );
        }
        throw error;
      }
      return { key };
    },
  }),
  defineMethod({
    product: "jira",
    path: "projects.list",
    risk: "read",
    options: [],
    signature:
      "/** Every project you can see. */ list(): Promise<{ key: string; name: string; type: string }[]>",
    parse: () => undefined,
    authorize: () => ({
      toolName: "jira_get_project",
      args: {},
      summary: "all projects",
    }),
    resource: () => "Jira projects",
    async run(_parsed, env) {
      const connection = await env.jira();
      const projects: Array<{ key: string; name: string; type: string }> = [];
      for (;;) {
        const page = await jiraRequest(connection, {
          parse: jsonObject,
          path: "/project/search",
          query: { startAt: projects.length, maxResults: PROJECT_PAGE_SIZE },
          signal: env.context.signal,
        });
        const batch = Array.isArray(page.values) ? page.values : [];
        for (const raw of batch) {
          const project = (raw ?? {}) as Record<string, unknown>;
          projects.push({
            key: String(project.key ?? ""),
            name: String(project.name ?? ""),
            type: String(project.projectTypeKey ?? ""),
          });
        }
        if (
          batch.length === 0 ||
          page.isLast === true ||
          projects.length >= MAX_PROJECTS
        ) {
          return projects.slice(0, MAX_PROJECTS);
        }
      }
    },
  }),
  defineMethod({
    product: "jira",
    path: "users.me",
    risk: "read",
    options: [],
    signature:
      "/** The authenticated user. */ me(): Promise<{ accountId: string; name: string; email: string | null; timeZone: string | null }>",
    parse: () => undefined,
    authorize: () => ({
      toolName: "jira_search_users",
      args: { query: "me" },
      summary: "current user",
    }),
    resource: () => "Jira user",
    run: (_parsed, env) => fetchJiraMe(env),
  }),
  definePositionalMethod({
    product: "jira",
    path: "adf.fromMarkdown",
    risk: "none",
    maxArgs: 1,
    signature:
      "/** For raw jira.request bodies; never for Confluence pages. */ fromMarkdown(markdown: string): object",
    parse: ([markdown]) => nonEmptyString(markdown, "markdown"),
    run: async (markdown) => markdownToAdf(markdown),
  }),
  definePositionalMethod({
    product: "jira",
    path: "adf.toMarkdown",
    risk: "none",
    maxArgs: 1,
    signature:
      "/** For raw jira.request responses (ADF documents); never for Confluence pages. */ toMarkdown(doc: object): string",
    parse: ([doc]) => {
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error(
          "doc must be an ADF document object ({ type: 'doc', ... }).",
        );
      }
      return doc;
    },
    run: async (doc) => adfToMarkdown(doc),
  }),
];
