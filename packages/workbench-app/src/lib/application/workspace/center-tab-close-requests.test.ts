import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canCloseDirtyFiles } from "./dirty-file-close-policy";

const files = [
  { id: "one", name: "src/one.ts" },
  { id: "two", name: "src/two.ts" },
];

describe("dirty file close policy", () => {
  it("aborts immediately when the user cancels", async () => {
    let prompted: typeof files | undefined;
    const result = await canCloseDirtyFiles(
      files,
      async (targets) => {
        prompted = targets;
        return "cancel";
      },
      async () => true,
    );

    assert.equal(result, false);
    assert.deepEqual(prompted, files);
  });

  it("saves requested files and aborts when a save fails", async () => {
    const saved: string[] = [];
    const result = await canCloseDirtyFiles(
      files,
      async () => "save",
      async (id) => {
        saved.push(id);
        return id !== "two";
      },
    );

    assert.equal(result, false);
    assert.deepEqual(saved, ["one", "two"]);
  });

  it("allows closing after discarded changes", async () => {
    const result = await canCloseDirtyFiles(
      files,
      async () => "discard",
      async () => {
        throw new Error("discard must not save");
      },
    );

    assert.equal(result, true);
  });
});
