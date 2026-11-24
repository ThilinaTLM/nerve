import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsNavGroup } from "$lib/presentation/settings";
import { phoneSettingsItems } from "./mobile-settings";

function group(id: string, ids: string[]): SettingsNavGroup {
  return {
    id,
    title: id,
    items: ids.map((item) => ({ id: item, label: item, icon: undefined! })),
  };
}

test("phone settings keep only devices and notifications, in nav order", () => {
  const items = phoneSettingsItems([
    group("agent", ["general", "tools"]),
    group("app", ["workbench", "notifications", "voice"]),
    group("system", ["storage", "devices", "system"]),
  ]);

  assert.deepEqual(
    items.map((item) => item.id),
    ["notifications", "devices"],
  );
});
