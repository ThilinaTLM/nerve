import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { convertSubagentSettings } from "./subagent-profiles.js";

function fixture(t: TestContext) {
  const home = mkdtempSync(join(tmpdir(), "nerve-profile-conversion-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "config"));
  mkdirSync(join(home, "agent/subagents"), { recursive: true });
  return home;
}
const markdown = `---
label: Reviewer
description: Portable review
model: fixture/model
thinking: high
permission: autonomous
compaction: {auto: false, profile: custom, triggerPercent: 75, keepRecentPercent: 20}
tools: {web_search: false, portable_tool: {mode: custom}}
skills: {portable-skill: true, disabled-skill: false}
enabled: true
---
# Instructions

Preserve this body.
`;

void test("converts Markdown without harness and merges explicit enabled preferences", (t) => {
  const home = fixture(t);
  const scratch = join(home, "scratch");
  writeFileSync(join(home, "agent/subagents/review.md"), markdown);
  writeFileSync(
    join(home, "config/subagents.json"),
    JSON.stringify({
      enabled: { review: false, explore: true, missing: false },
    }),
  );
  convertSubagentSettings(home, scratch);
  const document = JSON.parse(
    readFileSync(join(home, "config/subagents.json"), "utf8"),
  );
  const profile = document.profiles.review;
  assert.equal(document.schemaVersion, 1);
  assert.equal(profile.enabled, false);
  assert.equal(profile.model, "fixture/model");
  assert.equal(profile.thinking, "high");
  assert.equal(profile.permission, "autonomous");
  assert.equal(profile.instructions, "# Instructions\n\nPreserve this body.");
  assert.deepEqual(profile.tools, {
    web_search: false,
    portable_tool: { mode: "custom" },
  });
  assert.deepEqual(profile.skills, {
    "portable-skill": true,
    "disabled-skill": false,
  });
  assert.deepEqual(profile.compaction, {
    auto: false,
    profile: "custom",
    triggerPercent: 75,
    keepRecentPercent: 20,
  });
  assert.deepEqual(document.profiles.missing, { enabled: false });
  assert.equal(document.profiles.explore.enabled, true);
  assert(!existsSync(join(home, "agent/subagents/review.md")));
  assert.equal(convertSubagentSettings(home, scratch), 0);
  // An interrupted conversion can leave source Markdown after verified JSON.
  writeFileSync(join(home, "agent/subagents/review.md"), markdown);
  convertSubagentSettings(home, scratch);
  assert(!existsSync(join(home, "agent/subagents/review.md")));
});

void test("malformed targets and conflicting entries never overwrite JSON or remove sources", (t) => {
  const home = fixture(t);
  const source = join(home, "agent/subagents/review.md");
  const target = join(home, "config/subagents.json");
  writeFileSync(source, markdown);
  for (const raw of [
    "{broken",
    "null",
    "false",
    "0",
    '{"schemaVersion":2,"profiles":{}}',
    '{"schemaVersion":1,"profiles":{"review":{"instructions":"pinned"}}}',
    '{"enabled":{"review":"false"}}',
  ]) {
    writeFileSync(target, raw);
    assert.throws(() => convertSubagentSettings(home));
    assert.equal(readFileSync(target, "utf8"), raw);
    assert.equal(readFileSync(source, "utf8"), markdown);
  }
});

void test("existing JSON entries take precedence over harness customizations", (t) => {
  const home = fixture(t);
  const document = {
    schemaVersion: 1,
    profiles: { explore: { model: "lead", enabled: true } },
  };
  writeFileSync(join(home, "config/subagents.json"), JSON.stringify(document));
  writeFileSync(
    join(home, "config/harness.json"),
    JSON.stringify({
      exploreAgent: { model: { provider: "old", modelId: "model" } },
      tools: { disabled: ["explore"] },
    }),
  );
  convertSubagentSettings(home);
  assert.deepEqual(
    JSON.parse(readFileSync(join(home, "config/subagents.json"), "utf8")),
    document,
  );
  assert.equal(
    JSON.parse(readFileSync(join(home, "config/harness.json"), "utf8"))
      .exploreAgent,
    undefined,
  );
});

void test("invalid Markdown fails without removing any source", (t) => {
  const home = fixture(t);
  writeFileSync(
    join(home, "agent/subagents/review.md"),
    markdown.replace("thinking: high", "thinking: impossible"),
  );
  assert.throws(() => convertSubagentSettings(home));
  assert(existsSync(join(home, "agent/subagents/review.md")));
  assert(!existsSync(join(home, "config/subagents.json")));
});
