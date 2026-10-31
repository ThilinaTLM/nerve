import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDropPlan,
  dropActionLabel,
  dropBaseName,
  dropParentPath,
} from "./drop-to-open";

const projects = [
  { id: "p1", name: "inkwell", directory: "/home/u/Projects/inkwell" },
  { id: "p2", name: "Win", directory: "C:\\Work\\App" },
];

describe("drop-to-open", () => {
  it("classifies a new folder and a known project", () => {
    const fresh = buildDropPlan(
      [{ path: "/home/u/scratch", kind: "folder" }],
      projects,
    );
    assert.equal(fresh.variant, "folder");
    assert.equal(dropActionLabel(fresh.rows[0]), "Open project");

    const known = buildDropPlan(
      [{ path: "/home/u/Projects/inkwell/", kind: "folder" }],
      projects,
    );
    assert.equal(known.variant, "project");
    assert.equal(known.title, "Switch to inkwell?");
    assert.equal(dropActionLabel(known.rows[0]), "Switch to project");
  });

  it("matches Windows projects case-insensitively", () => {
    const plan = buildDropPlan(
      [{ path: "c:/work/app", kind: "folder" }],
      projects,
    );
    assert.equal(plan.rows[0].projectId, "p2");
  });

  it("offers the containing folder for a single file", () => {
    const plan = buildDropPlan(
      [
        {
          path: "/home/u/notes/README.md",
          kind: "file",
          containingFolder: { path: "/home/u/notes" },
        },
      ],
      projects,
    );
    assert.equal(plan.variant, "file");
    assert.equal(plan.rows[0].path, "/home/u/notes");
  });

  it("lets the user pick among several and skips files", () => {
    const plan = buildDropPlan(
      [
        { path: "/a/todo.md", kind: "file" },
        { path: "/a/one", kind: "folder" },
        { path: "/home/u/Projects/inkwell", kind: "folder" },
      ],
      projects,
    );
    assert.equal(plan.variant, "several");
    assert.equal(plan.defaultPick, 1);
    assert.equal(plan.rows[0].selectable, false);
    assert.equal(dropActionLabel(plan.rows[2]), "Switch to project");
  });

  it("reports nothing to open for files only", () => {
    const plan = buildDropPlan(
      [
        { path: "/a/x", kind: "file" },
        { path: "/a/y", kind: "file" },
      ],
      projects,
    );
    assert.equal(plan.variant, "none");
    assert.equal(plan.defaultPick, -1);
  });

  it("splits paths for both separators", () => {
    assert.equal(dropBaseName("C:\\Work\\App\\"), "App");
    assert.equal(dropParentPath("/home/u/a.txt"), "/home/u");
    assert.equal(dropParentPath("/a.txt"), "/");
    assert.equal(dropParentPath("C:\\a.txt"), "C:\\");
    assert.equal(dropParentPath("C:\\x\\a.txt"), "C:\\x");
  });
});
