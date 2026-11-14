import { executeQuickScript } from "./registry.js";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { quickScriptResultDetailsSchema } from "@nervekit/contracts/tools";
import { ToolExecutionError } from "@nervekit/tools/execution";
import {
  quickScriptFooter,
  reportLines,
  reconcileReport,
  type ChangeReport,
} from "@nervekit/tools/quick-script/testing";
import { type Nested, nestedName } from "@nervekit/tools/quick-script/testing";
import { atlassianPorts, mockedNetwork } from "./atlassian-context.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Authorization = Nested;

function makeContext(options: {
  events: string[];
  authorize?: (request: Authorization) => void;
}) {
  return {
    cwd: process.cwd(),
    extensionPorts: atlassianPorts(),
    webFetchPolicy: mockedNetwork,
    authorizeNested: async (request: Authorization) => {
      options.events.push(`authorize ${nestedName(request)}`);
      options.authorize?.(request);
    },
  };
}

function rawIssue(n: number) {
  return {
    id: String(n),
    key: `NER-${n}`,
    fields: {
      summary: `Issue ${n}`,
      status: { name: "Open", statusCategory: { name: "To Do" } },
      customfield_10016: 5,
      customfield_10020: { value: "Blue" },
    },
  };
}
void test("paginates search to the limit, resolves field names, and authorizes before HTTP", async () => {
  const events: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    events.push(`fetch ${url.pathname}`);
    if (url.pathname.endsWith("/field")) {
      return Response.json([
        { id: "customfield_10016", name: "Story Points", custom: true },
        { id: "customfield_10020", name: "Color", custom: true },
      ]);
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return body.nextPageToken
      ? Response.json({ issues: [rawIssue(3), rawIssue(4)] })
      : Response.json({
          issues: [rawIssue(1), rawIssue(2)],
          nextPageToken: "page2",
        });
  };
  const authorized: Authorization[] = [];
  const result = await executeQuickScript(
    {
      code: `
          const issues: any[] = await jira.issues.search({ jql: "project = NER", fields: ["summary", "Story Points", "Color"], limit: 3 });
          console.log(JSON.stringify(issues));
        `,
    },
    makeContext({ events, authorize: (r) => authorized.push(r) }),
  );
  assert.equal(result.exitCode, 0);
  const lines = (result.content ?? "").split("\n");
  const issues = JSON.parse(lines[0]) as Array<Record<string, unknown>>;
  assert.equal(issues.length, 3);
  assert.deepEqual(issues[0], {
    key: "NER-1",
    id: "1",
    url: "https://example.atlassian.net/browse/NER-1",
    summary: "Issue 1",
    "Story Points": 5,
    Color: "Blue",
  });
  assert.deepEqual(authorized, [
    { operation: "jira.issues.search", targets: [], risk: "network" },
  ]);
  assert.equal(events[0], "authorize jira.issues.search");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].nextPageToken, "page2");
  assert.equal(bodies[1].maxResults, 1);
  assert.deepEqual(bodies[0].fields, [
    "summary",
    "customfield_10016",
    "customfield_10020",
  ]);
  assert.match(lines.at(-1)!, /^jira 1 call \(issues\.search 1\) · exit 0/);
  assert.equal(
    quickScriptResultDetailsSchema.safeParse(result.details).success,
    true,
  );
});
void test("surfaces a denial as a catchable HostError and records it as denied", async () => {
  const events: string[] = [];
  globalThis.fetch = async () => {
    events.push("fetch");
    return Response.json({});
  };
  const result = await executeQuickScript(
    {
      code: `
          try { await jira.issues.get("NER-1"); } catch (e) { console.log("caught:", e.name, e.message); }
        `,
    },
    makeContext({
      events,
      authorize: () => {
        throw new ToolExecutionError("NESTED_DENIED", "Jira reads are denied");
      },
    }),
  );
  assert.deepEqual(events, ["authorize jira.issues.get"]);
  assert.match(result.content ?? "", /caught: HostError Jira reads are denied/);
  const details = quickScriptResultDetailsSchema.parse(result.details);
  assert.equal(details.hostCalls[0].outcome, "denied");
  assert.equal(details.hostCalls[0].authorizedAs, undefined);
  assert.deepEqual(details.hostCalls[0].targets, ["jira:issue/NER-1"]);
  assert.equal(details.hostCalls[0].summary, "NER-1");
  assert.match(result.content ?? "", /1 denied/);
});
void test("fails closed without authorizeNested", async () => {
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return Response.json({});
  };
  const context = {
    ...makeContext({ events: [] }),
    authorizeNested: undefined,
  };
  const result = await executeQuickScript(
    { code: `await jira.fields.list();` },
    context,
  );
  assert.equal(fetched, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.content ?? "", /Nested authorization is unavailable/);
});
void test("rejects unknown methods listing the valid ones", async () => {
  const result = await executeQuickScript(
    {
      code: `try { await host.call("jira.issues.remove", []); } catch (e) { console.log(e.message); }`,
    },
    makeContext({ events: [] }),
  );
  assert.match(
    result.content ?? "",
    /Unknown method 'jira\.issues\.remove'.*jira\.issues\.search/,
  );
  const details = quickScriptResultDetailsSchema.parse(result.details);
  assert.equal(details.hostCalls[0].outcome, "failed");
});
void test("reports script failures as a normal result with the error before the footer", async () => {
  const result = await executeQuickScript(
    { code: `console.log("before");\nthrow new Error("boom");` },
    makeContext({ events: [] }),
  );
  assert.equal(result.exitCode, 1);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "before");
  assert.match(result.content ?? "", /boom/);
  assert.match(lines.at(-1)!, /^failed · exit 1$/);
});

const call = (method: string) => ({
  method,
  outcome: "completed" as const,
  durationMs: 1,
});

void test("groups calls and shows duration only above one second", () => {
  assert.equal(
    quickScriptFooter({
      hostCalls: [
        call("jira.issues.search"),
        call("jira.issues.get"),
        call("jira.issues.get"),
      ],
      status: "completed",
      exitCode: 0,
      durationMs: 1234,
    }),
    "jira 3 calls (issues.search 1, issues.get 2) · exit 0 · 1.2s",
  );
  assert.equal(
    quickScriptFooter({
      hostCalls: [],
      status: "timed_out",
      exitCode: 124,
      durationMs: 500,
    }),
    "timed out · exit 124",
  );
});

void test("footer groups calls by product", () => {
  const call = (method: string) => ({
    method,
    outcome: "completed" as const,
    durationMs: 1,
  });
  assert.equal(
    quickScriptFooter({
      hostCalls: [
        call("jira.issues.get"),
        call("confluence.pages.get"),
        call("confluence.pages.get"),
      ],
      status: "completed",
      exitCode: 0,
      durationMs: 10,
    }),
    "jira 1 call (issues.get 1) · confluence 2 calls (pages.get 2) · exit 0",
  );
});

void test("failed scripts print the error once, above a message-free footer", async () => {
  const result = await executeQuickScript(
    { code: `throw new Error("boom");` },
    makeContext({ events: [] }),
  );
  const content = result.content ?? "";
  assert.equal(content.split("boom").length - 1, 1);
  assert.match(content.split("\n").at(-1)!, /^failed · exit 1$/);
});

const changes = (partial: Partial<ChangeReport>): ChangeReport => ({
  created: [],
  updated: [],
  deleted: [],
  raw: [],
  ...partial,
});

void test("created, updated and deleted entities are listed on capped lines", () => {
  assert.deepEqual(reportLines([], changes({})), []);
  assert.deepEqual(
    reportLines([], changes({ created: ["SCRUM-6", "comment 1 on SCRUM-6"] })),
    ["Created: SCRUM-6, comment 1 on SCRUM-6"],
  );
  const many = Array.from({ length: 23 }, (_, i) => `SCRUM-${i}`);
  const [line] = reportLines([], changes({ created: many }));
  assert.match(line, /SCRUM-19, \+3 more$/);
  assert.doesNotMatch(line, /SCRUM-20/);
});

void test("an entity created and then deleted in one run is only shown as deleted; created and updated is created", () => {
  const report = reconcileReport(
    changes({
      created: ["SCRUM-6", "SCRUM-7", "attachment 5 on page 1"],
      updated: ["SCRUM-7", "SCRUM-1"],
      deleted: ["SCRUM-6", "SCRUM-2", "attachment 5"],
      raw: ["POST /rest/api/3/x"],
    }),
  );
  assert.deepEqual(reportLines([], report), [
    "Created: SCRUM-7",
    "Updated: SCRUM-1",
    "Deleted: SCRUM-6 (created in this run), SCRUM-2, attachment 5 (created in this run)",
    "Raw: POST /rest/api/3/x",
  ]);
});

void test("the artifacts footer names the folder once so Read/Edit can open them", () => {
  const artifact = (name: string, bytes: number) => ({
    handle: `artifact:${name}`,
    path: `/data/conv/quick-script/${name}`,
    bytes,
    mediaType: "text/plain",
  });
  assert.deepEqual(
    reportLines(
      [artifact("a.txt", 5), artifact("résumé 日本.md", 2048)],
      changes({}),
    ),
    [
      "Artifacts: artifact:a.txt (5 B), artifact:résumé 日本.md (2.0 KB) in /data/conv/quick-script",
    ],
  );
});
