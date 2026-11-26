import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import {
  askAgentPrompt,
  attentionCounts,
  attentionEntries,
  attentionEntry,
  attentionSignature,
  attentionToastTitle,
  groupAttention,
  projectReviewEntries,
  reviewReminder,
} from "./configuration-attention";

const resource = (
  patch: Partial<ConfigurationResource>,
): ConfigurationResource => ({
  kind: "skill",
  id: "release-notes",
  scope: "project",
  path: "/p/.nerve/skills/release-notes/SKILL.md",
  state: "active",
  diagnostics: [],
  ...patch,
});
const error = (message: string) => ({
  level: "error" as const,
  code: "bad",
  message,
});

test("only invalid, incompatible, waiting or error-diagnostic resources get an entry", () => {
  assert.equal(attentionEntry(resource({})), undefined);
  assert.equal(
    attentionEntry(
      resource({
        diagnostics: [{ level: "warning", code: "w", message: "meh" }],
      }),
    ),
    undefined,
  );
  assert.equal(attentionEntry(resource({ state: "disabled" })), undefined);
  assert.equal(
    attentionEntry(resource({ scope: "builtin", state: "invalid" })),
    undefined,
  );
  assert.equal(
    attentionEntry(resource({ diagnostics: [error("x")] }))?.group,
    "broken",
  );
  assert.equal(
    attentionEntry(resource({ state: "needs_review" }))?.group,
    "review",
  );
  // A decline is final: it never asks for attention.
  assert.equal(attentionEntry(resource({ state: "declined" })), undefined);
});

test("an entry says what it is, where it comes from and the first diagnostic", () => {
  const broken = attentionEntry(
    resource({
      kind: "launch-catalog",
      id: "definitions.json",
      state: "invalid",
      diagnostics: [error("order must be 0, 1, 2"), error("second")],
    }),
  );
  assert.equal(broken?.title, "Launch definitions can't load");
  assert.equal(broken?.origin, "In this project, from the repository");
  assert.equal(broken?.detail, "order must be 0, 1, 2");
  assert.equal(broken?.askAgent, "fix");

  const upgrade = attentionEntry(
    resource({
      kind: "extension",
      id: "csv",
      scope: "user",
      state: "incompatible",
      diagnostics: [error("built for an older Nerve")],
    }),
  );
  assert.equal(upgrade?.title, "Extension csv needs an upgrade");
  assert.equal(upgrade?.origin, "Yours, every project");
  assert.equal(upgrade?.askAgent, "upgrade");

  const waiting = attentionEntry(resource({ state: "needs_review" }));
  assert.equal(waiting?.title, "Skill release-notes");
  assert.equal(waiting?.detail, "Not used until you trust it.");
  assert.equal(waiting?.askAgent, undefined);
});

test("review lands in the scope and page that holds the item", () => {
  const target = (patch: Partial<ConfigurationResource>) =>
    attentionEntry(resource({ state: "needs_review", ...patch }))?.target;
  assert.deepEqual(target({}), {
    scope: "project",
    pageId: "skills",
    item: "project:release-notes",
  });
  // Every item is decided on its own page; agent.json only on General.
  assert.deepEqual(target({ kind: "permission-overlay", id: "permissions" }), {
    scope: "project",
    pageId: "permission-rules",
  });
  assert.deepEqual(target({ kind: "agent-preferences", id: "agent.json" }), {
    scope: "project",
    pageId: "general",
  });
  assert.deepEqual(target({ kind: "agent-profile", id: "reviewer" }), {
    scope: "project",
    pageId: "agents",
    item: "project:reviewer",
  });
  assert.deepEqual(
    attentionEntry(
      resource({
        kind: "agent-profile",
        id: "helper",
        state: "needs_review",
      }),
      (scope, name) =>
        scope === "project" && name === "helper" ? "sub-agents" : undefined,
    )?.target,
    { scope: "project", pageId: "sub-agents", item: "project:helper" },
  );
  assert.deepEqual(target({ kind: "extension", id: "csv", scope: "user" }), {
    scope: "user",
    pageId: "extensions",
    item: "csv",
  });
  assert.deepEqual(target({ kind: "mcp-servers", id: "github" }), {
    scope: "project",
    pageId: "mcp-servers",
    item: "project:github",
  });
  assert.deepEqual(
    target({ kind: "mcp-servers", id: "github", scope: "user" }),
    {
      scope: "user",
      pageId: "mcp-servers",
      item: "user:github",
    },
  );
  assert.deepEqual(target({ kind: "mcp-servers", id: "mcp.json" }), {
    scope: "project",
    pageId: "mcp-servers",
  });
  assert.equal(
    attentionEntry(
      resource({ kind: "mcp-servers", id: "github", state: "needs_review" }),
    )?.title,
    "MCP server github",
  );
  assert.deepEqual(target({ kind: "prompt-suggestion", id: "next" }), {
    scope: "project",
    pageId: "suggestions",
  });
  // A broken skill has no review page: its details are the list.
  assert.deepEqual(
    attentionEntry(resource({ state: "invalid", diagnostics: [error("x")] }))
      ?.target,
    { scope: "project", pageId: "skills" },
  );
});

test("files the health entries already show are left to them", () => {
  const settings = resource({
    kind: "permission-overlay",
    id: "permissions",
    scope: "user",
    path: "/home/u/.nerve/config/permissions.json",
    state: "invalid",
    diagnostics: [error("priority")],
  });
  const launch = resource({
    kind: "launch-catalog",
    id: "definitions.json",
    path: "/p/.nerve/launches/definitions.json",
    state: "invalid",
    diagnostics: [error("order")],
  });
  const skill = resource({ state: "needs_review" });
  const entries = attentionEntries(
    [settings, launch, skill, skill],
    [
      "/home/u/.nerve/config/permissions.json",
      "/p/.nerve/launches/definitions.json/",
    ],
  );
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["skill"],
  );
  // Without the existing entries, the registry ones show.
  assert.equal(attentionEntries([settings, launch]).length, 2);
});

test("groups, counts and the set signature", () => {
  const entries = attentionEntries([
    resource({ state: "needs_review" }),
    resource({ kind: "permission-overlay", id: "p", state: "needs_review" }),
    resource({
      kind: "extension",
      id: "csv",
      scope: "user",
      state: "invalid",
      diagnostics: [error("x")],
    }),
  ]);
  const groups = groupAttention(entries);
  assert.equal(groups.review.length, 2);
  assert.equal(groups.broken.length, 1);
  const counts = attentionCounts(entries);
  assert.equal(counts.project, 2);
  // The broken user extension is not waiting for review: no badge.
  assert.equal(counts.user, 0);
  assert.deepEqual(counts.pages.project, {
    skills: 1,
    "permission-rules": 1,
  });
  assert.deepEqual(counts.pages.user, {});

  const reordered = [...entries].reverse();
  assert.equal(attentionSignature(entries), attentionSignature(reordered));
  assert.notEqual(
    attentionSignature(entries),
    attentionSignature(entries.slice(1)),
  );
  assert.equal(attentionSignature([]), "");
});

test("the toast names the cause", () => {
  const review = attentionEntries([resource({ state: "needs_review" })]);
  assert.equal(
    attentionToastTitle(review, "shop"),
    "shop has 1 item waiting for your review",
  );
  const upgrade = attentionEntries([
    resource({
      kind: "extension",
      id: "csv",
      scope: "user",
      state: "incompatible",
      diagnostics: [error("old")],
    }),
  ]);
  assert.equal(attentionToastTitle(upgrade), "1 extension needs an upgrade");
});

test("the agent prompt carries kind, id, scope, path and diagnostics and grants nothing", () => {
  const [entry] = attentionEntries([
    resource({
      kind: "launch-catalog",
      id: "definitions.json",
      path: "/p/.nerve/launches/definitions.json",
      state: "invalid",
      diagnostics: [
        {
          level: "error",
          code: "order",
          message: "bad order",
          pointer: "/definitions/2/order",
        },
      ],
    }),
  ]);
  const prompt = askAgentPrompt(entry!);
  for (const part of [
    "launch-catalog",
    "definitions.json",
    "project (from the repository)",
    "/p/.nerve/launches/definitions.json",
    "[error] order: bad order (/definitions/2/order)",
    "Do not approve or trust anything",
  ])
    assert.ok(prompt.includes(part), part);
});

test("the welcome reminds of project items that wait, never of declined ones", () => {
  const entries = attentionEntries([
    resource({ state: "needs_review" }),
    resource({ id: "other", state: "declined" }),
    resource({ id: "mine", scope: "user", state: "needs_review" }),
    resource({ id: "broken", state: "invalid", diagnostics: [error("x")] }),
  ]);
  assert.deepEqual(
    projectReviewEntries(entries).map((entry) => entry.id),
    ["release-notes"],
  );
  assert.equal(reviewReminder(1), "1 project file needs your review");
  assert.equal(reviewReminder(3), "3 project files need your review");
});
