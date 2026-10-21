import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  captureLegacyProfileEnablement,
  convertProfileScope,
  convertSubagentSettings,
  profileReceiptPath,
} from "./subagent-profiles.js";
import { parseProfileMarkdown } from "./subagent-profile-format.js";
import { runMigrations } from "../../framework/runner.js";
import { fixture as stepFixture, registry } from "./step-fixture.js";

const markdown = (enabled = "", tools = "{}", skills = "inherit") => `---
description: Fixture
model: lead
thinking: lead
permission: autonomous
compaction: inherit
tools: ${tools}
skills: ${skills}
${enabled}
---
Fixture instructions.
`;
function fixture(t: TestContext) {
  const temp = mkdtempSync(join(tmpdir(), "nerve-profile-safety-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const home = join(temp, "storage-2");
  const root = join(home, "project/.nerve");
  mkdirSync(join(home, "config"), { recursive: true });
  mkdirSync(join(home, "agent/subagents"), { recursive: true });
  mkdirSync(join(root, "subagents"), { recursive: true });
  return { home, root, scratch: join(home, "scratch") };
}

void test("registered project conversion retains captured global false across an import crash", async (t) => {
  const home = await stepFixture(t);
  writeFileSync(
    join(home, "config/subagents.json"),
    JSON.stringify({ enabled: { developer: false, explore: false } }),
  );
  const source = join(home, "project/.nerve/subagents");
  writeFileSync(join(source, "developer.md"), markdown());
  writeFileSync(join(source, "explore.md"), markdown("enabled: true"));
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase, done }) => {
        if (phase === "import" && done === 1)
          throw new Error("profile checkpoint interruption");
      },
    }),
    /profile checkpoint interruption/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(home, "config/subagents.json"), "utf8"))
      .schemaVersion,
    1,
  );
  assert(existsSync(join(source, "explore.md")));
  await runMigrations(home, { registry });
  const profiles = JSON.parse(
    readFileSync(join(home, "project/.nerve/config/subagents.json"), "utf8"),
  ).profiles;
  assert.equal(profiles.developer.enabled, false);
  assert.equal(profiles.explore.enabled, false);
  assert(!existsSync(join(source, "developer.md")));
});

void test("harness Explore disable is captured before rewrite and overrides Markdown/global true", (t) => {
  const { home, root, scratch } = fixture(t);
  writeFileSync(
    join(home, "config/subagents.json"),
    JSON.stringify({ enabled: { explore: true } }),
  );
  writeFileSync(
    join(home, "config/harness.json"),
    JSON.stringify({ tools: { disabled: ["explore"] } }),
  );
  const enabled = captureLegacyProfileEnablement(home, scratch);
  assert.equal(enabled.explore, false);
  convertSubagentSettings(home, scratch);
  assert.equal(
    JSON.parse(readFileSync(join(home, "config/subagents.json"), "utf8"))
      .profiles.explore.enabled,
    false,
  );
  assert.deepEqual(captureLegacyProfileEnablement(home, scratch), enabled);
  writeFileSync(join(root, "subagents/explore.md"), markdown("enabled: true"));
  convertProfileScope(root, join(root, "subagents"), [], false, {
    legacyEnabled: enabled,
  });
  assert.equal(
    JSON.parse(readFileSync(join(root, "config/subagents.json"), "utf8"))
      .profiles.explore.enabled,
    false,
  );
});

void test("constructor is a valid own profile name, including preferences and project overrides", (t) => {
  const { home, root, scratch } = fixture(t);
  writeFileSync(join(home, "agent/subagents/constructor.md"), markdown());
  writeFileSync(
    join(home, "config/subagents.json"),
    '{"enabled":{"constructor":false}}',
  );
  const enabled = captureLegacyProfileEnablement(home, scratch);
  convertSubagentSettings(home, scratch);
  const profiles = JSON.parse(
    readFileSync(join(home, "config/subagents.json"), "utf8"),
  ).profiles;
  assert(Object.hasOwn(profiles, "constructor"));
  assert.equal(profiles.constructor.enabled, false);
  writeFileSync(
    join(root, "subagents/constructor.md"),
    markdown("enabled: true"),
  );
  convertProfileScope(root, join(root, "subagents"), [], false, {
    legacyEnabled: enabled,
  });
  assert.equal(
    JSON.parse(readFileSync(join(root, "config/subagents.json"), "utf8"))
      .profiles.constructor.enabled,
    false,
  );
});

void test("different enabled targets fail; only receipt-proven resume retains canonical choices", (t) => {
  const { home, root, scratch } = fixture(t);
  const source = join(root, "subagents/review.md");
  const target = join(root, "config/subagents.json");
  const raw = markdown("enabled: true");
  mkdirSync(join(root, "config"));
  writeFileSync(source, raw);
  const canonical = {
    schemaVersion: 1,
    profiles: {
      review: { ...parseProfileMarkdown("review", raw), enabled: false },
    },
  };
  writeFileSync(target, JSON.stringify(canonical));
  assert.throws(
    () => convertProfileScope(root, join(root, "subagents")),
    /collision/,
  );
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), canonical);
  assert(existsSync(source));
  rmSync(target);
  const options = {
    legacyEnabled: { review: false },
    receiptPath: profileReceiptPath(scratch, root),
  };
  convertProfileScope(root, join(root, "subagents"), [], false, options);
  writeFileSync(source, raw);
  convertProfileScope(root, join(root, "subagents"), [], false, {
    receiptPath: options.receiptPath,
  });
  assert(!existsSync(source));
  // Receipt authorization requires the unchanged source digest as well.
  writeFileSync(
    source,
    raw.replace("Fixture instructions.", "Changed instructions."),
  );
  assert.throws(
    () =>
      convertProfileScope(root, join(root, "subagents"), [], false, {
        receiptPath: options.receiptPath,
      }),
    /collision/,
  );
  assert(existsSync(source));
  // Modifying the target invalidates the receipt and cannot authorize deletion.
  writeFileSync(source, raw);
  const changed = JSON.parse(readFileSync(target, "utf8"));
  changed.profiles.review.instructions = "Edited after conversion";
  writeFileSync(target, JSON.stringify(changed));
  assert.throws(
    () =>
      convertProfileScope(root, join(root, "subagents"), [], false, {
        receiptPath: options.receiptPath,
      }),
    /collision/,
  );
  assert(existsSync(source));
  assert(existsSync(home));
});

void test("symlinked .nerve/config cannot read/write outside scope or delete legacy Markdown", (t) => {
  const { home, root } = fixture(t);
  const outside = join(home, "outside");
  mkdirSync(outside);
  const original = '{"schemaVersion":1,"profiles":{}}';
  writeFileSync(join(outside, "subagents.json"), original);
  symlinkSync(outside, join(root, "config"), "dir");
  const source = join(root, "subagents/review.md");
  writeFileSync(source, markdown());
  assert.throws(
    () => convertProfileScope(root, join(root, "subagents")),
    /Symlinked migration path/,
  );
  assert.equal(readFileSync(join(outside, "subagents.json"), "utf8"), original);
  assert(existsSync(source));
});

void test("project whole-map shadowing requires manual review, with all sources untouched", (t) => {
  for (const field of ["tools", "skills"] as const) {
    const { root } = fixture(t);
    const source = join(root, "subagents/review.md");
    writeFileSync(
      source,
      markdown("", "{}", field === "skills" ? "{selected: true}" : "inherit"),
    );
    writeFileSync(join(root, "subagents/other.md"), markdown());
    const inherited =
      field === "tools"
        ? { tools: { web_search: true } }
        : { skills: { selected: true, extra: false } };
    assert.throws(
      () =>
        convertProfileScope(root, join(root, "subagents"), [], false, {
          inheritedProfiles: { review: inherited },
        }),
      /Manual review required.*whole-definition capability shadowing/,
    );
    assert(existsSync(source));
    assert(existsSync(join(root, "subagents/other.md")));
    assert(!existsSync(join(root, "config/subagents.json")));
  }
});

void test("skill modes replace safely, and canonical sparse entries are not rewritten", (t) => {
  for (const mode of ["inherit", "none"]) {
    const { root } = fixture(t);
    writeFileSync(join(root, "subagents/review.md"), markdown("", "{}", mode));
    convertProfileScope(root, join(root, "subagents"), [], false, {
      inheritedProfiles: { review: { skills: { extra: true } } },
    });
    assert.equal(
      JSON.parse(readFileSync(join(root, "config/subagents.json"), "utf8"))
        .profiles.review.skills,
      mode,
    );
  }
  const { root } = fixture(t);
  mkdirSync(join(root, "config"));
  const target = join(root, "config/subagents.json");
  const original =
    '{"schemaVersion":1,"profiles":{"review":{"enabled":true,"tools":{}}}}';
  writeFileSync(target, original);
  assert.equal(
    convertProfileScope(root, join(root, "subagents"), [], false, {
      legacyEnabled: { review: false },
      inheritedProfiles: { review: { tools: { web_search: true } } },
    }),
    0,
  );
  assert.equal(readFileSync(target, "utf8"), original);
});
