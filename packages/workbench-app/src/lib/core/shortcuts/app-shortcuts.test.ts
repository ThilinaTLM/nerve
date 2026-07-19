import assert from "node:assert/strict";
import test from "node:test";
import { createAppShortcuts } from "./app-shortcuts.svelte";
import type { CenterTabIdentity } from "$lib/features/workspace";

class ShortcutTarget {
  constructor(private readonly editable: boolean) {}

  closest(): ShortcutTarget | null {
    return this.editable ? this : null;
  }
}

Object.defineProperty(globalThis, "Element", {
  configurable: true,
  value: ShortcutTarget,
});

function shortcutEvent(target: EventTarget | null = null): {
  event: KeyboardEvent;
  prevented: () => boolean;
} {
  let defaultPrevented = false;
  const event = {
    key: "w",
    code: "KeyW",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target,
    preventDefault: () => {
      defaultPrevented = true;
    },
  } as unknown as KeyboardEvent;

  return { event, prevented: () => defaultPrevented };
}

function shortcutOptions(
  activeTab: CenterTabIdentity | undefined,
  closeCenterTab: (tab: CenterTabIdentity) => void,
): Parameters<typeof createAppShortcuts>[0] {
  return {
    currentZoomLevel: () => 0,
    setUiZoomLevel: () => undefined,
    centerTabs: () => (activeTab ? [activeTab] : []),
    activeCenterTab: () => activeTab,
    selectCenterTab: () => undefined,
    newConversation: () => undefined,
    openProjectPicker: () => undefined,
    closeCenterTab,
    closeCenterTabs: () => undefined,
    centerTabsExcept: () => [],
    refreshCenterTab: () => undefined,
    focusProjectSearch: () => undefined,
    hasConversationComposer: () => false,
    sending: () => false,
    abortActiveRun: () => undefined,
    composerEscape: () => undefined,
    toggleMic: () => undefined,
    selectedPermissionLevel: () => "supervised",
    setComposerPermission: () => undefined,
    usableModels: () => [],
    selectedModelKey: () => "",
    selectedThinkingLevel: () => "off",
    setComposerThinkingLevel: () => undefined,
    selectedMode: () => "coding",
    setComposerMode: () => undefined,
  };
}

test("Ctrl+W closes the active pane from an editable target", () => {
  const activeTab: CenterTabIdentity = { kind: "settings", id: "settings" };
  let closedTab: CenterTabIdentity | undefined;
  const shortcuts = createAppShortcuts(
    shortcutOptions(activeTab, (tab) => {
      closedTab = tab;
    }),
  );
  const { event, prevented } = shortcutEvent(
    new ShortcutTarget(true) as unknown as EventTarget,
  );

  shortcuts.handleWorkbenchShortcut(event);

  assert.deepEqual(closedTab, activeTab);
  assert.equal(prevented(), true);
});

test("Ctrl+W prevents native window close when there is no active pane", () => {
  let closeCalls = 0;
  const shortcuts = createAppShortcuts(
    shortcutOptions(undefined, () => {
      closeCalls += 1;
    }),
  );
  const { event, prevented } = shortcutEvent();

  shortcuts.handleWorkbenchShortcut(event);

  assert.equal(closeCalls, 0);
  assert.equal(prevented(), true);
});
