import assert from "node:assert/strict";
import test from "node:test";
import type { CenterTabIdentity } from "./workspace-state.svelte";
import {
  mostRecentTab,
  reorderTabs,
  startupTabActivationLane,
  tabIdentityKey,
} from "./tab-session-helpers";

const a = { kind: "conversation", id: "a" } as const;
const b = { kind: "conversation", id: "b" } as const;
const c = { kind: "conversation", id: "c" } as const;
const d = { kind: "conversation", id: "d" } as const;

test("reorders visual tabs without changing an independent MRU list", () => {
  const mru = [tabIdentityKey(b), tabIdentityKey(a), tabIdentityKey(c)];
  assert.deepEqual(reorderTabs([a, b, c], a, 2), [b, c, a]);
  assert.deepEqual(mru, ["conversation:b", "conversation:a", "conversation:c"]);
});

test("closing the active tab falls back to the previously active tab", () => {
  const mru = [
    tabIdentityKey(d),
    tabIdentityKey(a),
    tabIdentityKey(c),
    tabIdentityKey(b),
  ];
  assert.deepEqual(mostRecentTab([a, b, c, d], mru, [d]), a);
});

test("falls back deterministically when MRU data is absent", () => {
  assert.deepEqual(mostRecentTab([a, b, c], [], [a]), b);
});

test("supports global singleton identities in the same ordering model", () => {
  const settings: CenterTabIdentity = { kind: "settings", id: "settings" };
  const discover: CenterTabIdentity = { kind: "discover", id: "discover" };
  assert.deepEqual(reorderTabs([a, settings, discover, b], discover, 3), [
    a,
    settings,
    b,
    discover,
  ]);
});

test("only restored conversations activate in the critical lane", () => {
  const cases: Array<[CenterTabIdentity | undefined, string]> = [
    [undefined, "none"],
    [{ kind: "conversation", id: "conversation" }, "critical"],
    [{ kind: "pr", id: "pr" }, "progressive"],
    [{ kind: "diff", id: "diff" }, "progressive"],
    [{ kind: "task", id: "task" }, "progressive"],
    [{ kind: "file", id: "file" }, "progressive"],
    [{ kind: "mermaid", id: "mermaid" }, "progressive"],
    [{ kind: "settings", id: "settings" }, "progressive"],
    [{ kind: "discover", id: "discover" }, "progressive"],
  ];
  for (const [tab, expected] of cases)
    assert.equal(startupTabActivationLane(tab), expected);
});
