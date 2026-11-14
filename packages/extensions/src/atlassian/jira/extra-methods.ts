import { extname } from "node:path";
import { jsonObject } from "../shared/http.js";
import {
  attachmentTooLarge,
  jiraDownloadToArtifact,
  jiraRequest,
  pathSegment,
  type JiraConnection,
} from "./client.js";
import { adfToMarkdown } from "./adf-markdown.js";
import { markdownToAdf } from "./markdown-adf.js";
import {
  artifactNameOf,
  artifactNameFor,
  MAX_ATTACHMENT_BYTES,
} from "../shared/files.js";
import type { BinaryNaming } from "../shared/raw-request.js";
import { codedError, hasStatus } from "../shared/errors.js";
import { noteChange } from "./report.js";
import { nonEmptyString } from "../shared/args.js";
import {
  defineMethod,
  definePositionalMethod,
  type PathedMethod,
} from "../shared/define-method.js";
import type { JiraSession } from "./session.js";
import { jiraAttachment, jiraIssue } from "../shared/targets.js";

const MAX_PROJECTS = 1000;
const PROJECT_PAGE_SIZE = 50;

/** The current user, shared with `atlassian.defaults()`. */
export async function fetchJiraMe(
  session: { connection: JiraConnection },
  connection?: JiraConnection,
) {
  const me = await jiraRequest(connection ?? session.connection, {
    parse: jsonObject,
    path: "/myself",
  });
  return {
    accountId: String(me.accountId ?? ""),
    name: String(me.displayName ?? ""),
    email: typeof me.emailAddress === "string" ? me.emailAddress : null,
    timeZone: typeof me.timeZone === "string" ? me.timeZone : null,
  };
}

/** `jira.request` binary responses: saved as `response-<n>` with the path's file extension. */
export function rawBinaryNaming(path: unknown): BinaryNaming {
  const extension = extname(String(path).split("?")[0] ?? "") || ".bin";
  return { base: "response", extensionFor: () => extension };
}

export const jiraExtraMethods: PathedMethod<JiraSession>[] = [
  defineMethod({
    product: "jira",
    path: "attachments.download",
    risk: "network",
    bare: "id",
    options: ["id", "name"],
    signature:
      "/** Saves as `artifact:<filename>` (or `name`); max 100 MB. */ download(options: string | { id: string; name?: string }): Promise<FileHandle>",
    parse: (options) => ({
      id: nonEmptyString(options.id, "id"),
      name:
        options.name === undefined ? undefined : artifactNameOf(options.name),
    }),
    authorize: ({ id }) => ({
      targets: [jiraAttachment(id)],
      summary: `attachment ${id}`,
    }),
    resource: ({ id }) => `attachment ${id}`,
    async run({ id, name }, session) {
      const connection = session.connection;
      const meta = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/attachment/${pathSegment(id)}`,
      });
      if (typeof meta.size === "number" && meta.size > MAX_ATTACHMENT_BYTES) {
        throw attachmentTooLarge(id, meta.size);
      }
      const filename = artifactNameFor(
        String(meta.filename ?? `attachment-${id}`),
      );
      let target = name;
      if (!target) {
        const extension = extname(filename);
        target = await session.ctx.artifacts.freshName(
          filename.slice(0, filename.length - extension.length),
          extension,
        );
      }
      const { artifact } = await jiraDownloadToArtifact(connection, id, {
        name: target,
      });
      return artifact.handle;
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.delete",
    risk: "destructive",
    bare: "key",
    options: ["key", "subtasks"],
    signature:
      "/** `subtasks: true` also deletes subtasks (required if any). */ delete(options: string | { key: string; subtasks?: boolean }): Promise<{ key: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      subtasks: options.subtasks === true,
    }),
    authorize: ({ key }) => ({
      targets: [jiraIssue(key)],
      summary: `DELETE issue ${key}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, subtasks }, session) {
      try {
        await jiraRequest(session.connection, {
          method: "DELETE",
          path: `/issue/${pathSegment(key)}`,
          query: { deleteSubtasks: subtasks },
        });
      } catch (error) {
        if (!subtasks && hasStatus(error, 400)) {
          throw codedError(
            "BAD_REQUEST",
            `${key} was not deleted, probably because it has subtasks: pass { key: "${key}", subtasks: true } to delete them too. ${error.message}`,
          );
        }
        throw error;
      }
      noteChange(session, "deleted", key);
      return { key };
    },
  }),
  defineMethod({
    product: "jira",
    path: "projects.list",
    risk: "network",
    options: [],
    signature: "list(): Promise<{ key: string; name: string; type: string }[]>",
    parse: () => undefined,
    authorize: () => ({
      targets: [],
      summary: "all projects",
    }),
    resource: () => "Jira projects",
    async run(_parsed, session) {
      const connection = session.connection;
      const projects: Array<{ key: string; name: string; type: string }> = [];
      for (;;) {
        const page = await jiraRequest(connection, {
          parse: jsonObject,
          path: "/project/search",
          query: { startAt: projects.length, maxResults: PROJECT_PAGE_SIZE },
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
    risk: "network",
    options: [],
    signature:
      "me(): Promise<{ accountId: string; name: string; email: string | null; timeZone: string | null }>",
    parse: () => undefined,
    authorize: () => ({
      targets: [],
      summary: "current user",
    }),
    resource: () => "Jira user",
    run: (_parsed, session) => fetchJiraMe(session),
  }),
  definePositionalMethod({
    product: "jira",
    path: "adf.fromMarkdown",
    risk: "none",
    maxArgs: 1,
    signature: "fromMarkdown(markdown: string): object",
    parse: ([markdown]) => nonEmptyString(markdown, "markdown"),
    run: async (markdown) => markdownToAdf(markdown),
  }),
  definePositionalMethod({
    product: "jira",
    path: "adf.toMarkdown",
    risk: "none",
    maxArgs: 1,
    signature: "toMarkdown(doc: object): string",
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
