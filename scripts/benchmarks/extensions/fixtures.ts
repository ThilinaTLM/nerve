/** Jira and Confluence fixture helpers: plain REST through the product clients. */
import type { Loose } from "./loose.ts";
import type { Atlassian } from "./atlassian.ts";
import type { TaskContext } from "./types.ts";

export function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface IssueSeed {
  summary: string;
  description?: string;
  extraLabels?: string[];
  status?: "To Do" | "In Progress" | "In Review" | "Done";
}

/** Create a labelled issue in the sandbox project; deleted again on cleanup. */
export async function createIssue(
  ctx: TaskContext,
  seed: IssueSeed,
): Promise<string> {
  const { atlassian } = ctx;
  const created = await atlassian.jira<{ key: string }>({
    method: "POST",
    path: "/issue",
    body: {
      fields: {
        project: { key: ctx.sandbox.jiraProject },
        summary: seed.summary,
        issuetype: { name: "Task" },
        labels: [ctx.tag, ...(seed.extraLabels ?? [])],
        ...(seed.description ? { description: adf(seed.description) } : {}),
      },
    },
  });
  ctx.onCleanup(`delete ${created.key}`, async () => {
    await atlassian
      .jira({
        method: "DELETE",
        path: `/issue/${created.key}`,
        query: { deleteSubtasks: true },
      })
      .catch(ignoreNotFound);
  });
  if (seed.status && seed.status !== "To Do")
    await transitionIssue(atlassian, created.key, seed.status);
  return created.key;
}

export async function transitionIssue(
  atlassian: Atlassian,
  key: string,
  name: string,
): Promise<void> {
  const { transitions } = await atlassian.jira<{
    transitions: { id: string; name: string }[];
  }>({ path: `/issue/${key}/transitions` });
  const target = transitions.find(
    (transition) => transition.name.toLowerCase() === name.toLowerCase(),
  );
  if (!target) throw new Error(`${key}: no transition named ${name}`);
  await atlassian.jira({
    method: "POST",
    path: `/issue/${key}/transitions`,
    body: { transition: { id: target.id } },
  });
}

export async function getIssue(
  atlassian: Atlassian,
  key: string,
  fields: string[] = ["summary", "status", "labels", "description"],
): Promise<Loose> {
  return atlassian.jira({ path: `/issue/${key}`, query: { fields } });
}

export async function createPage(
  ctx: TaskContext,
  title: string,
  storage: string,
): Promise<{ id: string; version: number }> {
  const { atlassian } = ctx;
  const page = await atlassian.confluence<{
    id: string;
    version: { number: number };
  }>({
    method: "POST",
    path: "/content",
    body: {
      type: "page",
      title,
      space: { key: ctx.sandbox.confluenceSpace },
      body: { storage: { value: storage, representation: "storage" } },
    },
  });
  registerPageCleanup(ctx, title);
  return { id: page.id, version: page.version.number };
}

/** Remove every page with this title in the sandbox space, including trash. */
export function registerPageCleanup(ctx: TaskContext, title: string): void {
  const { atlassian } = ctx;
  ctx.onCleanup(`delete page "${title}"`, async () => {
    for (const page of await atlassian.searchPages(title)) {
      await atlassian
        .confluence({ method: "DELETE", path: `/content/${page.id}` })
        .catch(ignoreNotFound);
      await atlassian
        .confluence({
          method: "DELETE",
          path: `/content/${page.id}`,
          query: { status: "trashed" },
        })
        .catch(ignoreNotFound);
    }
  });
}

export async function updatePage(
  atlassian: Atlassian,
  id: string,
  title: string,
  storage: string,
  version: number,
): Promise<number> {
  const page = await atlassian.confluence<{ version: { number: number } }>({
    method: "PUT",
    path: `/content/${id}`,
    body: {
      type: "page",
      title,
      version: { number: version },
      body: { storage: { value: storage, representation: "storage" } },
    },
  });
  return page.version.number;
}

export async function getPage(
  atlassian: Atlassian,
  id: string,
): Promise<{ title: string; version: number; storage: string }> {
  const page = await atlassian.confluence<Loose>({
    path: `/content/${id}`,
    query: { expand: "version,body.storage" },
  });
  return {
    title: page.title,
    version: page.version.number,
    storage: page.body.storage.value,
  };
}

export function ignoreNotFound(error: unknown): void {
  if (/404|not found|does not exist/i.test(String((error as Error)?.message)))
    return;
  throw error;
}

/** True when `answer` states `count` next to `label` (either order, same line). */
export function mentionsCount(
  answer: string,
  label: string,
  count: number,
): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`${escaped}[^0-9\\n]{0,20}\\b${count}\\b`, "i").test(answer) ||
    new RegExp(`\\b${count}\\b[^\\n]{0,20}${escaped}`, "i").test(answer)
  );
}

export function mentionsKey(answer: string, key: string): boolean {
  return new RegExp(`\\b${key}\\b`).test(answer);
}
