import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composerReferencesFromDrag } from "./composer-drag-references";

describe("composer drag references", () => {
  it("maps files, directories and launches to mention chips", () => {
    assert.deepEqual(
      composerReferencesFromDrag([
        { type: "project-entry", path: "src/main.ts", kind: "file" },
        { type: "project-entry", path: "src/lib", kind: "directory" },
        { type: "launch", id: "ld_1", label: "Dev", title: "pnpm dev" },
        { type: "launch", id: "ld_2", label: "Docs" },
      ]),
      [
        {
          insert: "@src/main.ts",
          label: "main.ts",
          kind: "file",
          title: "src/main.ts",
        },
        {
          insert: "@src/lib/",
          label: "lib/",
          kind: "directory",
          title: "src/lib/",
        },
        {
          insert: "@launch:ld_1",
          label: "Dev",
          kind: "launch_definition",
          title: "pnpm dev",
        },
        {
          insert: "@launch:ld_2",
          label: "Docs",
          kind: "launch_definition",
          title: "@launch:ld_2",
        },
      ],
    );
  });
});
