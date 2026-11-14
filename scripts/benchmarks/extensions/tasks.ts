/**
 * The task set. Each task creates its own labelled fixtures in the sandbox
 * (Jira project and Confluence space from `--jira-project` / `--space`), gives
 * the model one prompt, and verifies the outcome with read-only requests or
 * against the final answer. Everything a task creates is removed by the
 * cleanup actions it registers; nothing outside the fixtures is touched.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createIssue,
  createPage,
  escapeHtml,
  getIssue,
  getPage,
  mentionsCount,
  mentionsKey,
  registerPageCleanup,
  updatePage,
} from "./fixtures.ts";
import {
  type CheckResult,
  type TaskContext,
  type TaskDefinition,
  TaskSkipped,
} from "./types.ts";
import { buildXlsx } from "./xlsx.ts";

function result(failures: string[]): CheckResult {
  return { pass: failures.length === 0, failures };
}

function includes(answer: string, needle: string): boolean {
  return answer.toLowerCase().includes(needle.toLowerCase());
}

const lookupIssue: TaskDefinition = {
  id: "lookup-issue",
  title: "Single lookup: issue status and description detail",
  category: "lookup",
  writes: true,
  estimatedModelCalls: 4,
  async setup(ctx) {
    const codeword = `harbor-${ctx.runId}`;
    const summary = `[bench ${ctx.runId}] Rotate gateway certificates`;
    const key = await createIssue(ctx, {
      summary,
      description: `Escalation codeword: ${codeword}`,
      status: "In Progress",
    });
    Object.assign(ctx.data, { key, codeword });
    return `In the Jira project ${ctx.sandbox.jiraProject}, find the issue titled "${summary}". Tell me its key, its current status and the escalation codeword from its description.`;
  },
  scope: () => ({}),
  async check(ctx, { answer }) {
    const failures: string[] = [];
    if (!mentionsKey(answer, String(ctx.data.key)))
      failures.push(`answer lacks the key ${ctx.data.key}`);
    if (!includes(answer, "in progress"))
      failures.push('answer lacks the status "In Progress"');
    if (!includes(answer, String(ctx.data.codeword)))
      failures.push(`answer lacks the codeword ${ctx.data.codeword}`);
    return result(failures);
  },
};

const lookupPage: TaskDefinition = {
  id: "lookup-page",
  title: "Single lookup: Confluence page facts",
  category: "lookup",
  writes: true,
  estimatedModelCalls: 4,
  async setup(ctx) {
    const title = `[bench ${ctx.runId}] Runbook: queue drain`;
    const minutes = 20 + (Number.parseInt(ctx.runId.slice(0, 2), 36) % 70);
    const owner = `team-${ctx.runId}`;
    await createPage(
      ctx,
      title,
      `<p>Maximum drain time: <strong>${minutes} minutes</strong></p><p>Owner: ${owner}</p><p>Escalate to the on-call lead after the limit.</p>`,
    );
    Object.assign(ctx.data, { minutes, owner });
    return `In the Confluence space ${ctx.sandbox.confluenceSpace}, find the page titled "${title}". What is the maximum drain time and who owns the runbook?`;
  },
  scope: () => ({}),
  async check(ctx, { answer }) {
    const failures: string[] = [];
    if (!new RegExp(`\\b${ctx.data.minutes}\\b`).test(answer))
      failures.push(`answer lacks the drain time ${ctx.data.minutes}`);
    if (!includes(answer, String(ctx.data.owner)))
      failures.push(`answer lacks the owner ${ctx.data.owner}`);
    return result(failures);
  },
};

const joinIssuesPage: TaskDefinition = {
  id: "join-issues-page",
  title: "Cross-call join: page lists issue keys, Jira holds their status",
  category: "join",
  writes: true,
  estimatedModelCalls: 6,
  async setup(ctx) {
    const specs = [
      { name: "Gate login", status: "Done" },
      { name: "Gate billing", status: "In Progress" },
      { name: "Gate export", status: "Done" },
      { name: "Gate audit", status: "To Do" },
    ] as const;
    const keys: string[] = [];
    for (const spec of specs)
      keys.push(
        await createIssue(ctx, {
          summary: `[bench ${ctx.runId}] ${spec.name}`,
          status: spec.status,
        }),
      );
    const title = `[bench ${ctx.runId}] Release blockers`;
    await createPage(
      ctx,
      title,
      `<p>Release blockers</p><table><tbody><tr><th>Key</th><th>Area</th></tr>${keys
        .map(
          (key, index) =>
            `<tr><td>${key}</td><td>${escapeHtml(specs[index]!.name)}</td></tr>`,
        )
        .join("")}</tbody></table>`,
    );
    const open = keys.filter((_, i) => specs[i]!.status !== "Done");
    const done = keys.filter((_, i) => specs[i]!.status === "Done");
    Object.assign(ctx.data, { open, done });
    return `The Confluence page "${title}" in space ${ctx.sandbox.confluenceSpace} lists release-blocking Jira issues by key. Which of them are not Done yet? Answer with the keys and their current statuses.`;
  },
  scope: () => ({}),
  async check(ctx, { answer }) {
    const failures: string[] = [];
    for (const key of ctx.data.open as string[])
      if (!mentionsKey(answer, key)) failures.push(`answer lacks open ${key}`);
    // Naming a done key is fine when the answer says it is Done; listing it
    // as open (a line with the key but without "done") is the error.
    for (const key of ctx.data.done as string[])
      if (
        answer
          .split("\n")
          .some((line) => mentionsKey(line, key) && !/\bdone\b/i.test(line))
      )
        failures.push(`answer wrongly lists done ${key} as open`);
    return result(failures);
  },
};

const joinStatusCounts: TaskDefinition = {
  id: "join-status-counts",
  title: "Cross-call join: group a label's issues by status",
  category: "join",
  writes: true,
  estimatedModelCalls: 5,
  async setup(ctx) {
    const plan = [
      "To Do",
      "To Do",
      "To Do",
      "In Progress",
      "In Progress",
      "Done",
    ] as const;
    for (const [index, status] of plan.entries())
      await createIssue(ctx, {
        summary: `[bench ${ctx.runId}] Counting item ${index + 1}`,
        status,
      });
    return `How many issues in the Jira project ${ctx.sandbox.jiraProject} carry the label "${ctx.tag}", grouped by status? Reply with one line per status in the form "Status: count".`;
  },
  scope: () => ({}),
  async check(_ctx, { answer }) {
    const failures: string[] = [];
    for (const [label, count] of [
      ["To Do", 3],
      ["In Progress", 2],
      ["Done", 1],
    ] as const)
      if (!mentionsCount(answer, label, count))
        failures.push(`answer lacks "${label}: ${count}"`);
    return result(failures);
  },
};

const bulkLabel: TaskDefinition = {
  id: "bulk-label",
  title: "Bulk update with approvals: add a label to a set of issues",
  category: "bulk",
  writes: true,
  estimatedModelCalls: 8,
  async setup(ctx) {
    const keys: string[] = [];
    for (let index = 1; index <= 5; index++)
      keys.push(
        await createIssue(ctx, {
          summary: `[bench ${ctx.runId}] Bulk label ${index}`,
        }),
      );
    Object.assign(ctx.data, { keys, label: `reviewed-${ctx.runId}` });
    return `Add the label "${ctx.data.label}" to every issue in the Jira project ${ctx.sandbox.jiraProject} that has the label "${ctx.tag}". Keep their existing labels and change nothing else.`;
  },
  scope: (ctx) => ({ issueKeys: ctx.data.keys as string[] }),
  async check(ctx) {
    const failures: string[] = [];
    for (const key of ctx.data.keys as string[]) {
      const labels: string[] =
        (await getIssue(ctx.atlassian, key, ["labels"])).fields.labels ?? [];
      if (!labels.includes(String(ctx.data.label)))
        failures.push(`${key} lacks ${ctx.data.label}`);
      if (!labels.includes(ctx.tag)) failures.push(`${key} lost ${ctx.tag}`);
    }
    const labelled = await ctx.atlassian.searchJql(
      `project = ${ctx.sandbox.jiraProject} AND labels = "${ctx.data.label}"`,
      ["summary"],
    );
    if (labelled.length !== (ctx.data.keys as string[]).length)
      failures.push(
        `${labelled.length} issues carry ${ctx.data.label}, expected ${(ctx.data.keys as string[]).length}`,
      );
    return result(failures);
  },
};

const bulkTransitionComment: TaskDefinition = {
  id: "bulk-transition-comment",
  title: "Bulk update with approvals: transition and comment on each issue",
  category: "bulk",
  writes: true,
  estimatedModelCalls: 10,
  async setup(ctx) {
    const keys: string[] = [];
    for (let index = 1; index <= 4; index++)
      keys.push(
        await createIssue(ctx, {
          summary: `[bench ${ctx.runId}] Triage ${index}`,
        }),
      );
    Object.assign(ctx.data, { keys, comment: `bench-checked ${ctx.runId}` });
    return `Move every issue in the Jira project ${ctx.sandbox.jiraProject} that has the label "${ctx.tag}" to "In Progress", and add the comment "${ctx.data.comment}" to each of them.`;
  },
  scope: (ctx) => ({ issueKeys: ctx.data.keys as string[] }),
  async check(ctx) {
    const failures: string[] = [];
    for (const key of ctx.data.keys as string[]) {
      const issue = await getIssue(ctx.atlassian, key, ["status"]);
      if (issue.fields.status.name !== "In Progress")
        failures.push(`${key} is ${issue.fields.status.name}`);
      const comments = await ctx.atlassian.jira<{
        comments: { body: unknown }[];
      }>({ path: `/issue/${key}/comment` });
      const count = comments.comments.filter((comment) =>
        JSON.stringify(comment.body).includes(String(ctx.data.comment)),
      ).length;
      if (count !== 1) failures.push(`${key} has ${count} matching comments`);
    }
    return result(failures);
  },
};

const salesRows = [
  ["Region", "Q1", "Q2", "Q3"],
  ["North", 120, 135, 150],
  ["South", 90, 95, 110],
  ["East", 75, 80, 70],
  ["West", 140, 160, 175],
] as const;

const excelToConfluence: TaskDefinition = {
  id: "excel-to-confluence",
  title: "Excel to Confluence page with a chart diagram",
  category: "document",
  writes: true,
  estimatedModelCalls: 14,
  async setup(ctx) {
    await mkdir(ctx.workspaceDir, { recursive: true });
    await writeFile(
      join(ctx.workspaceDir, "sales.xlsx"),
      buildXlsx(salesRows.map((row) => [...row])),
    );
    const title = `[bench ${ctx.runId}] Quarterly sales`;
    registerPageCleanup(ctx, title);
    Object.assign(ctx.data, { title });
    return `The workbook sales.xlsx in the working directory holds quarterly sales per region. Create a Confluence page titled "${title}" in the space ${ctx.sandbox.confluenceSpace} with a table of all the data from the workbook and a bar chart of the Q3 sales by region, rendered as a diagram image embedded in the page.`;
  },
  scope: () => ({ allowCreate: true, allowShell: true }),
  async check(ctx) {
    const failures: string[] = [];
    const pages = await ctx.atlassian.searchPages(String(ctx.data.title));
    if (pages.length !== 1) {
      failures.push(`${pages.length} pages titled ${ctx.data.title}`);
      return result(failures);
    }
    const page = await getPage(ctx.atlassian, pages[0].id);
    const text = page.storage.replace(/<[^>]+>/g, " ");
    for (const row of salesRows.slice(1))
      for (const cell of row)
        if (!new RegExp(`(^|\\D)${cell}(\\D|$)`).test(text))
          failures.push(`page lacks ${cell}`);
    const attachments = await ctx.atlassian.confluence<{ size: number }>({
      path: `/content/${pages[0].id}/child/attachment`,
    });
    if (!attachments.size) failures.push("page has no attachment");
    if (!/<ac:image|ri:attachment|<img/i.test(page.storage))
      failures.push("page body does not embed an image");
    return result(failures);
  },
};

const pitfallCustomField: TaskDefinition = {
  id: "pitfall-custom-field",
  title: "Pitfall: set a custom field given only its display name",
  category: "pitfall",
  writes: true,
  estimatedModelCalls: 6,
  async setup(ctx) {
    const summary = `[bench ${ctx.runId}] Estimate me`;
    const key = await createIssue(ctx, { summary });
    Object.assign(ctx.data, { key, summary });
    return `Set the "Story point estimate" of ${key} to 5. Do not change anything else on the issue.`;
  },
  scope: (ctx) => ({ issueKeys: [String(ctx.data.key)] }),
  async check(ctx) {
    const failures: string[] = [];
    const fields = await ctx.atlassian.jira<{ id: string; name: string }[]>({
      path: "/field",
    });
    const field = fields.find((entry) => entry.name === "Story point estimate");
    if (!field) return result(["site has no Story point estimate field"]);
    const issue = await getIssue(ctx.atlassian, String(ctx.data.key), [
      field.id,
      "summary",
    ]);
    if (issue.fields[field.id] !== 5)
      failures.push(`story points are ${issue.fields[field.id]}`);
    if (issue.fields.summary !== ctx.data.summary)
      failures.push("summary changed");
    return result(failures);
  },
};

const pitfallTransitionField: TaskDefinition = {
  id: "pitfall-transition-field",
  title: "Pitfall: transition that requires a field",
  category: "pitfall",
  writes: true,
  estimatedModelCalls: 7,
  async setup(ctx) {
    const key = await createIssue(ctx, {
      summary: `[bench ${ctx.runId}] Needs a transition field`,
    });
    const { transitions } = await ctx.atlassian.jira<{
      transitions: {
        name: string;
        fields?: Record<string, { required: boolean; name: string }>;
      }[];
    }>({
      path: `/issue/${key}/transitions`,
      query: { expand: "transitions.fields" },
    });
    const target = transitions.find((transition) =>
      Object.values(transition.fields ?? {}).some((field) => field.required),
    );
    if (!target)
      throw new TaskSkipped(
        `no workflow transition in ${ctx.sandbox.jiraProject} has a required field`,
      );
    const required = Object.values(target.fields!)
      .filter((field) => field.required)
      .map((field) => field.name);
    Object.assign(ctx.data, { key, target: target.name });
    return `Move ${key} to "${target.name}". The transition requires: ${required.join(", ")}; choose sensible values yourself.`;
  },
  scope: (ctx) => ({ issueKeys: [String(ctx.data.key)] }),
  async check(ctx) {
    const issue = await getIssue(ctx.atlassian, String(ctx.data.key), [
      "status",
    ]);
    return result(
      issue.fields.status.name === ctx.data.target
        ? []
        : [`status is ${issue.fields.status.name}`],
    );
  },
};

const pitfallStaleVersion: TaskDefinition = {
  id: "pitfall-stale-version",
  title: "Pitfall: edit a page whose version moved on",
  category: "pitfall",
  writes: true,
  estimatedModelCalls: 7,
  async setup(ctx) {
    const title = `[bench ${ctx.runId}] Release checklist`;
    const page = await createPage(
      ctx,
      title,
      "<p>Release checklist</p><ul><li>Item A</li></ul>",
    );
    const list = (count: number) =>
      `<p>Release checklist</p><ul>${["A", "B", "C"]
        .slice(0, count)
        .map((item) => `<li>Item ${item}</li>`)
        .join("")}</ul>`;
    let version = page.version;
    for (const count of [2, 3])
      version = await updatePage(
        ctx.atlassian,
        page.id,
        title,
        list(count),
        version + 1,
      );
    Object.assign(ctx.data, { id: page.id, title, version });
    return `Add the bullet "Item D ${ctx.runId}" at the end of the list on the Confluence page "${title}" in space ${ctx.sandbox.confluenceSpace}. A colleague last saw this page at version 1; keep every existing item.`;
  },
  scope: (ctx) => ({ pageIds: [String(ctx.data.id)] }),
  async check(ctx) {
    const failures: string[] = [];
    const page = await getPage(ctx.atlassian, String(ctx.data.id));
    for (const needle of ["Item A", "Item B", "Item C", `Item D ${ctx.runId}`])
      if (!page.storage.includes(needle)) failures.push(`page lacks ${needle}`);
    if (page.version <= Number(ctx.data.version))
      failures.push(`page still at version ${page.version}`);
    return result(failures);
  },
};

/** The cheap one-call lookup used by `--smoke`. */
export const SMOKE_TASK = "lookup-issue";

export const TASKS: readonly TaskDefinition[] = [
  lookupIssue,
  lookupPage,
  joinIssuesPage,
  joinStatusCounts,
  bulkLabel,
  bulkTransitionComment,
  excelToConfluence,
  pitfallCustomField,
  pitfallTransitionField,
  pitfallStaleVersion,
];

/** Structural validation of the task file; returns one message per problem. */
export function validateTasks(tasks: readonly TaskDefinition[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const categories = ["lookup", "join", "bulk", "document", "pitfall"];
  for (const task of tasks) {
    if (!/^[a-z][a-z0-9-]*$/.test(task.id))
      problems.push(`task id "${task.id}" is not kebab-case`);
    if (seen.has(task.id)) problems.push(`duplicate task id ${task.id}`);
    seen.add(task.id);
    if (!task.title.trim()) problems.push(`${task.id}: empty title`);
    if (!categories.includes(task.category))
      problems.push(`${task.id}: unknown category ${task.category}`);
    if (!(task.estimatedModelCalls > 0))
      problems.push(`${task.id}: estimatedModelCalls must be positive`);
    for (const member of ["setup", "scope", "check"] as const)
      if (typeof task[member] !== "function")
        problems.push(`${task.id}: ${member} is not a function`);
  }
  if (!seen.has(SMOKE_TASK)) problems.push(`smoke task ${SMOKE_TASK} missing`);
  return problems;
}

export function selectTasks(ids: readonly string[] | undefined) {
  if (!ids) return TASKS;
  const unknown = ids.filter((id) => !TASKS.some((task) => task.id === id));
  if (unknown.length)
    throw new Error(
      `Unknown task id(s): ${unknown.join(", ")}. Known: ${TASKS.map((task) => task.id).join(", ")}`,
    );
  return TASKS.filter((task) => ids.includes(task.id));
}

export type { TaskContext };
