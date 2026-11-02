import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsNavGroup } from "$lib/presentation/settings";
import { mobileSettingsGroups } from "./mobile-settings";

function group(id: string, ids: string[]): SettingsNavGroup {
  return {
    id,
    title: id,
    items: ids.map((item) => ({ id: item, label: item, icon: undefined! })),
  };
}

test("mobile settings drop desktop-only pages and the groups they empty", () => {
  const groups = mobileSettingsGroups([
    group("agent", ["general", "tools"]),
    group("catalog", ["agents", "sub-agents", "permission-rules", "models"]),
    group("app", ["workbench", "shortcuts", "voice"]),
  ]);

  assert.deepEqual(
    groups.map((entry) => [entry.id, entry.items.map((item) => item.id)]),
    [
      ["agent", ["general", "tools"]],
      ["app", ["workbench", "voice"]],
    ],
  );
});
