import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectExploreDraftTasks } from "./explore-draft";

describe("Explore draft task projection", () => {
  it("starts with one anonymous placeholder", () => {
    assert.deepEqual(projectExploreDraftTasks({ argsText: '{"tasks":[' }), [
      {
        key: "task-0",
        index: 0,
        count: 1,
        label: undefined,
        task: undefined,
        status: "drafting",
      },
    ]);
  });

  it("adds stable cards as task objects begin and fills partial titles", () => {
    const first = projectExploreDraftTasks({
      argsText: '{"tasks":[{"task":"Inspect server","label":"Ser',
    });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.key, "task-0");
    assert.equal(first[0]?.label, "Ser");
    assert.equal(first[0]?.task, "Inspect server");

    const second = projectExploreDraftTasks({
      argsText:
        '{"tasks":[{"task":"Inspect server","label":"Server"},{"task":"Review cl',
    });
    assert.equal(second.length, 2);
    assert.deepEqual(
      second.map((task) => task.key),
      ["task-0", "task-1"],
    );
    assert.equal(second[0]?.label, "Server");
    assert.equal(second[1]?.task, "Review cl");
    assert.equal(second[0]?.count, 2);
  });

  it("prefers labels and supports final and legacy single-task arguments", () => {
    const exact = projectExploreDraftTasks({
      args: {
        tasks: [
          { task: "Long task A", label: "A" },
          { task: "Long task B", label: "B" },
        ],
      },
    });
    assert.equal(exact[0]?.label, "A");
    assert.equal(exact[1]?.label, "B");

    assert.deepEqual(
      projectExploreDraftTasks({
        argsText: '{"task":"Inspect one thing","label":"Focused',
      })[0],
      {
        key: "task-0",
        index: 0,
        count: 1,
        label: "Focused",
        task: "Inspect one thing",
        status: "drafting",
      },
    );
  });
});
