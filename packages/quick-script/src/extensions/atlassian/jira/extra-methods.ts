import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { jsonObject } from "../shared/http.js";
import { ToolExecutionError } from "@nervekit/tools/execution";
import {
  type JiraConnection,
  jiraDownloadToFile,
  jiraRequest,
  pathSegment,
} from "./client.js";
import { adfToMarkdown } from "./adf-markdown.js";
import { markdownToAdf } from "./markdown-adf.js";
import {
  artifactBinarySink,
  artifactNameOf,
  artifactNameFor,
  artifactTempPath,
  commitArtifact,
  freshArtifactName,
  MAX_ATTACHMENT_BYTES,
} from "../../../runtime/files/artifacts.js";
import { codedError } from "../../../runtime/errors.js";
import { noteChange } from "./report.js";
import { nonEmptyString } from "../../../runtime/sdk-args.js";
import {
  defineMethod,
  definePositionalMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../../../runtime/sdk-types.js";
import { jiraAttachment, jiraIssue } from "../shared/targets.js";

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

/** `jira.request` onBinary: streams a binary response into an artifact named after the path's file extension. */
export function rawBinarySaver(env: SdkEnvironment, path: unknown) {
  const extension = extname(String(path).split("?")[0] ?? "") || ".bin";
  return artifactBinarySink(env, "response", () => extension);
}

export const jiraExtraMethods: SdkMethod[] = [
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
          `Attachment ${id} is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`,
        );
      if (typeof meta.size === "number" && meta.size > MAX_ATTACHMENT_BYTES) {
        throw tooBig(meta.size);
      }
      const tempPath = await artifactTempPath(env);
      const downloaded = await jiraDownloadToFile(connection, id, {
        destination: tempPath,
        maxBytes: MAX_ATTACHMENT_BYTES,
        signal: env.context.signal,
      }).catch((error: unknown) => {
        if (
          error instanceof ToolExecutionError &&
          error.code === "JIRA_ATTACHMENT_TOO_LARGE"
        ) {
          throw tooBig(Number(error.details?.bytes ?? 0));
        }
        throw error;
      });
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
        ).catch(async (error: unknown) => {
          await rm(tempPath, { force: true });
          throw error;
        });
      }
      return await commitArtifact(env, tempPath, target);
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
      noteChange(env, "deleted", key);
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
    run: (_parsed, env) => fetchJiraMe(env),
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
