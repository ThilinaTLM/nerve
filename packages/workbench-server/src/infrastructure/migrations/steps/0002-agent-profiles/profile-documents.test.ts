import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { createStepContext } from "../../framework/context.js";
import { toolkitState } from "../../framework/toolkit.js";
import { RollbackJournal } from "../../framework/rollback-journal.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  convertProfileDocument,
  convertAppliedProfileDocument,
  upgradeProfileDocuments,
} from "./profile-documents.js";

void test("unreleased profile documents rename when-to-use and drop only profile source defaults", () => {
  const before = {
    schemaVersion: 1,
    name: "review",
    label: "Review",
    description: "Use for review.",
    instructions: "Keep description and skills.defaults in this prose.",
    recommendations: {
      skills: { defaults: { file: false }, file: { review: true } },
    },
    requirements: { skills: { defaults: { nerve: false } } },
  };
  const after = convertProfileDocument(before);
  assert.deepEqual(after, {
    schemaVersion: 1,
    name: "review",
    label: "Review",
    whenToUse: "Use for review.",
    instructions: before.instructions,
    recommendations: { skills: { file: { review: true } } },
    requirements: {},
  });
  assert.deepEqual(convertProfileDocument(after), after);
  assert.equal(before.description, "Use for review.");
  assert.throws(
    () => convertProfileDocument({ ...before, whenToUse: "Different" }),
    /Conflicting/,
  );
});
void test("captured contributions lose source defaults but conversation choices and frozen settings retain them", () => {
  const settings = {
    skills: { defaults: { file: false }, file: { review: true } },
  };
  const before = {
    overrides: settings,
    frozenSettings: settings,
    appliedProfile: { recommendations: settings, requirements: settings },
  };
  assert.deepEqual(convertAppliedProfileDocument(before), {
    overrides: settings,
    frozenSettings: settings,
    appliedProfile: {
      recommendations: { skills: { file: { review: true } } },
      requirements: { skills: { file: { review: true } } },
    },
  });
});

void test("applied homes upgrade only home profiles and never open registered project profiles", (t) => {
  const home = mkdtempSync(join(tmpdir(), "nerve-profile-revision-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  const project = join(home, "project");
  mkdirSync(join(home, "data"), { recursive: true });
  const db = new DatabaseSync(paths.sqlitePath);
  db.exec("CREATE TABLE project (id INTEGER PRIMARY KEY, directory TEXT)");
  db.prepare("INSERT INTO project (directory) VALUES (?)").run(project);
  db.close();
  const before = JSON.stringify({
    schemaVersion: 1,
    name: "review",
    label: "Review",
    description: "Use for review.",
    usableBy: "both",
    instructions: "",
    recommendations: { skills: { defaults: { file: false } } },
  });
  const files = [
    join(home, "data/agent-profiles/review.json"),
    join(project, ".nerve/agent-profiles/review.json"),
  ];
  for (const file of files) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, before);
  }
  const { context } = createStepContext(
    paths,
    "0002-agent-profiles",
    "Profiles",
    () => {},
  );
  upgradeProfileDocuments(context);
  upgradeProfileDocuments(context, true);
  const after = JSON.parse(readFileSync(files[0], "utf8"));
  assert.equal(after.whenToUse, "Use for review.");
  assert.equal(after.description, undefined);
  assert.deepEqual(after.recommendations, {});
  assert.equal(readFileSync(files[1], "utf8"), before);
  // A malformed/newer project document cannot block an applied-home rerun.
  writeFileSync(files[1], "not JSON");
  upgradeProfileDocuments(context);
  upgradeProfileDocuments(context, true);
  assert.equal(readFileSync(files[1], "utf8"), "not JSON");
  new RollbackJournal(context.scratchDir).restore();
  assert.equal(readFileSync(files[0], "utf8"), before);
  assert.equal(readFileSync(files[1], "utf8"), "not JSON");
});

void test("damaged applied-home profile documents are retained and quarantined independently", (t) => {
  const home = mkdtempSync(join(tmpdir(), "nerve-profile-damaged-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const files = [
    join(home, "data/agent-profiles/broken.json"),
    join(home, "data/conversations/c/config/agent.json"),
  ];
  for (const path of files) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "broken JSON");
  }
  const { context } = createStepContext(
    storagePaths(home),
    "0002-agent-profiles",
    "Profiles",
    () => {},
  );
  upgradeProfileDocuments(context);
  upgradeProfileDocuments(context, true);
  assert.equal(toolkitState(context).setAside.length, 2);
  for (const item of toolkitState(context).setAside) {
    assert.equal(readFileSync(item.id, "utf8"), "broken JSON");
    assert.equal(
      readFileSync(
        join(item.quarantinePath, "payload", basename(item.id)),
        "utf8",
      ),
      "broken JSON",
    );
  }
});
