/** Shared mocked-HTTP harness for the Jira quick-script tests. */
import { createHarness, type HarnessOptions } from "../test-support.js";

export type Sent = {
  method: string;
  path: string;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};
export { returned, type Nested } from "../test-support.js";

export const FIELDS = [
  { id: "summary", name: "Summary", custom: false, schema: { type: "string" } },
  {
    id: "description",
    name: "Description",
    custom: false,
    schema: { type: "string" },
  },
  {
    id: "assignee",
    name: "Assignee",
    custom: false,
    schema: { type: "user", system: "assignee" },
  },
  {
    id: "priority",
    name: "Priority",
    custom: false,
    schema: { type: "priority" },
  },
  {
    id: "labels",
    name: "Labels",
    custom: false,
    schema: { type: "array", items: "string" },
  },
  {
    id: "customfield_10016",
    name: "Story Points",
    custom: true,
    schema: { type: "number" },
  },
  {
    id: "customfield_10050",
    name: "Severity",
    custom: true,
    schema: { type: "option" },
  },
  {
    id: "resolution",
    name: "Resolution",
    custom: false,
    schema: { type: "resolution" },
  },
];

export const CREATE_FIELDS = [
  {
    fieldId: "summary",
    name: "Summary",
    required: true,
    schema: { type: "string" },
  },
  {
    fieldId: "project",
    name: "Project",
    required: true,
    schema: { type: "project" },
  },
  {
    fieldId: "priority",
    name: "Priority",
    required: false,
    schema: { type: "priority" },
    allowedValues: [{ name: "High" }, { name: "Low" }],
  },
  {
    fieldId: "customfield_10050",
    name: "Severity",
    required: true,
    schema: { type: "option" },
    allowedValues: [{ value: "S1" }, { value: "S2" }],
  },
  {
    fieldId: "customfield_10016",
    name: "Story Points",
    required: false,
    schema: { type: "number" },
  },
  {
    fieldId: "description",
    name: "Description",
    required: false,
    schema: { type: "string" },
  },
  {
    fieldId: "assignee",
    name: "Assignee",
    required: false,
    schema: { type: "user" },
  },
  {
    fieldId: "labels",
    name: "Labels",
    required: false,
    schema: { type: "array", items: "string" },
  },
];

export const TRANSITIONS = [
  { id: "11", name: "Start", to: { name: "In Progress" }, fields: {} },
  {
    id: "31",
    name: "Finish",
    to: { name: "Done" },
    fields: {
      resolution: {
        name: "Resolution",
        required: true,
        schema: { type: "resolution" },
        allowedValues: [{ name: "Done" }, { name: "Won't Do" }],
      },
    },
  },
];

export function setup(
  extra?: (sent: Sent) => Response | undefined,
  options: Omit<HarnessOptions, "fetch"> = {},
) {
  const sent: Sent[] = [];
  const fetch: HarnessOptions["fetch"] = async (url, init) => {
    const entry: Sent = {
      method: init.method,
      path: url.pathname.replace("/rest/api/3", ""),
      query: url.searchParams,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    };
    sent.push(entry);
    const custom = extra?.(entry);
    if (custom) return custom;
    const { method, path } = entry;
    if (path === "/field") return Response.json(FIELDS);
    if (path === "/issue/createmeta/APP/issuetypes")
      return Response.json({
        issueTypes: [
          { id: "1", name: "Bug", subtask: false },
          { id: "2", name: "Task", subtask: false },
        ],
      });
    if (path === "/issue/createmeta/APP/issuetypes/1")
      return Response.json({ fields: CREATE_FIELDS });
    if (path === "/issue/createmeta/APP/issuetypes/2")
      return Response.json({ fields: CREATE_FIELDS.slice(0, 3) });
    if (path === "/user/assignable/search")
      return Response.json([
        {
          accountId: "acc-1",
          displayName: "Ann Lee",
          emailAddress: "ann@example.com",
          active: true,
        },
      ]);
    if (method === "POST" && path === "/issue")
      return Response.json({ id: "10", key: "APP-10" });
    if (path.endsWith("/editmeta"))
      return Response.json({
        fields: {
          priority: {
            name: "Priority",
            schema: { type: "priority" },
            allowedValues: [{ name: "High" }, { name: "Low" }],
          },
          description: { name: "Description", schema: { type: "string" } },
        },
      });
    if (path.endsWith("/transitions") && method === "GET")
      return Response.json({ transitions: TRANSITIONS });
    if (method === "POST" && path.endsWith("/comment"))
      return Response.json({ id: "77" });
    if (method === "POST" && path.endsWith("/worklog"))
      return Response.json({ id: "5", timeSpent: "1h 30m" });
    if (path === "/issueLinkType")
      return Response.json({
        issueLinkTypes: [
          { name: "Blocks", inward: "is blocked by", outward: "blocks" },
        ],
      });
    if (path === "/issue/APP-1/attachments")
      return Response.json([{ id: "9", filename: "n.txt", size: 2 }]);
    return new Response(null, { status: 204 });
  };
  const harness = createHarness({ ...options, fetch });
  const run = (code: string) => harness.run(code);
  return { sent, authorized: harness.authorized, run, harness };
}

export const lastOf = (sent: Sent[], method: string, path: string) =>
  sent.filter((s) => s.method === method && s.path === path).at(-1);
