import assert from "node:assert/strict";
import test from "node:test";
import { createAppShortcuts } from "./app-shortcuts.svelte";
import type { CenterTabIdentity } from "$lib/application/workspace";

class ShortcutTarget {
  constructor(
    private readonly editable: boolean,
    private readonly composer = false,
  ) {}

  closest(selector: string): ShortcutTarget | null {
    if (selector === "[data-prompt-composer-editor]")
      return this.composer ? this : null;
    return this.editable ? this : null;
  }
}

Object.defineProperty(globalThis, "Element", {
  configurable: true,
  value: ShortcutTarget,
});

function shortcutEvent(
  target: EventTarget | null = null,
  overrides: Partial<KeyboardEvent> = {},
): {
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
    ...overrides,
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
    selectedPermissionRuleSetId: () => "supervised",
    permissionRuleSetIds: () => ["read_only", "supervised", "autonomous"],
    setComposerPermissionRuleSet: () => undefined,
    usableModels: () => [],
    selectedModelKey: () => "",
    setComposerModel: () => undefined,
    selectedThinkingLevel: () => "off",
    setComposerThinkingLevel: () => undefined,
    selectedMode: () => "coding",
    setComposerMode: () => undefined,
    togglePanelDock: () => undefined,
  };
}

test("cycles through the available permission rule sets", () => {
  let selected = "supervised";
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    selectedPermissionRuleSetId: () => selected,
    permissionRuleSetIds: () => ["read_only", "supervised", "custom"],
    setComposerPermissionRuleSet: (value) => {
      selected = value;
    },
  });

  assert.equal(shortcuts.cyclePermissionRuleSet(), true);
  assert.equal(selected, "custom");
});

test("does not cycle the fixed Planning rule set", () => {
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    selectedPermissionRuleSetId: () => "planning",
    permissionRuleSetIds: () => ["planning"],
  });

  assert.equal(shortcuts.cyclePermissionRuleSet(), false);
});

test("Ctrl+N creates a conversation from an editable target", () => {
  let created = 0;
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    newConversation: () => {
      created += 1;
    },
  });
  const { event, prevented } = shortcutEvent(
    new ShortcutTarget(true, true) as unknown as EventTarget,
    { key: "n", code: "KeyN" },
  );

  shortcuts.handleWorkbenchShortcut(event);

  assert.equal(created, 1);
  assert.equal(prevented(), true);
});

test("Shift+Tab toggles mode only from the prompt composer", () => {
  let mode: "coding" | "planning" = "coding";
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    selectedMode: () => mode,
    setComposerMode: (value) => {
      mode = value;
    },
  });
  const outside = shortcutEvent(
    new ShortcutTarget(true) as unknown as EventTarget,
    { key: "Tab", code: "Tab", ctrlKey: false, shiftKey: true },
  );
  shortcuts.handleWorkbenchShortcut(outside.event);
  assert.equal(mode, "coding");
  assert.equal(outside.prevented(), false);

  const inside = shortcutEvent(
    new ShortcutTarget(true, true) as unknown as EventTarget,
    { key: "Tab", code: "Tab", ctrlKey: false, shiftKey: true },
  );
  shortcuts.handleWorkbenchShortcut(inside.event);
  assert.equal(mode, "planning");
  assert.equal(inside.prevented(), true);
});

test("Alt+M cycles scoped models and wraps", () => {
  let selected = "anthropic:a";
  const selectedValues: string[] = [];
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    usableModels: () =>
      [
        { provider: "anthropic", modelId: "a" },
        { provider: "openai", modelId: "b" },
      ] as ReturnType<Parameters<typeof createAppShortcuts>[0]["usableModels"]>,
    selectedModelKey: () => selected,
    setComposerModel: (value) => {
      selected = value;
      selectedValues.push(value);
    },
  });
  const target = new ShortcutTarget(true, true) as unknown as EventTarget;

  shortcuts.handleWorkbenchShortcut(
    shortcutEvent(target, {
      key: "m",
      code: "KeyM",
      ctrlKey: false,
      altKey: true,
    }).event,
  );
  shortcuts.handleWorkbenchShortcut(
    shortcutEvent(target, {
      key: "m",
      code: "KeyM",
      ctrlKey: false,
      altKey: true,
    }).event,
  );

  assert.deepEqual(selectedValues, ["openai:b", "anthropic:a"]);
});

test("model cycling is a no-op with one scoped model", () => {
  let changed = false;
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    usableModels: () =>
      [{ provider: "anthropic", modelId: "a" }] as ReturnType<
        Parameters<typeof createAppShortcuts>[0]["usableModels"]
      >,
    selectedModelKey: () => "anthropic:a",
    setComposerModel: () => {
      changed = true;
    },
  });

  assert.equal(shortcuts.cycleModel(), false);
  assert.equal(changed, false);
});

test("Alt+T cycles only the selected model's reasoning levels", () => {
  let level: "off" | "high" = "off";
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    usableModels: () =>
      [
        {
          provider: "anthropic",
          modelId: "a",
          supportedThinkingLevels: ["off", "high"],
        },
      ] as ReturnType<Parameters<typeof createAppShortcuts>[0]["usableModels"]>,
    selectedModelKey: () => "anthropic:a",
    selectedThinkingLevel: () => level,
    setComposerThinkingLevel: (value) => {
      level = value as "off" | "high";
    },
  });
  const event = shortcutEvent(
    new ShortcutTarget(true, true) as unknown as EventTarget,
    { key: "t", code: "KeyT", ctrlKey: false, altKey: true },
  );

  shortcuts.handleWorkbenchShortcut(event.event);

  assert.equal(level, "high");
  assert.equal(event.prevented(), true);
});

test("reasoning cycling is a no-op when the model has one level", () => {
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    hasConversationComposer: () => true,
    usableModels: () =>
      [
        {
          provider: "anthropic",
          modelId: "a",
          supportedThinkingLevels: ["off"],
        },
      ] as ReturnType<Parameters<typeof createAppShortcuts>[0]["usableModels"]>,
    selectedModelKey: () => "anthropic:a",
  });

  assert.equal(shortcuts.cycleThinkingLevel(), false);
});

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

test("Ctrl+B toggles the left dock while an editable target is focused", () => {
  const toggled: string[] = [];
  const shortcuts = createAppShortcuts({
    ...shortcutOptions(undefined, () => undefined),
    togglePanelDock: (dock) => toggled.push(dock),
  });
  const { event } = shortcutEvent(
    new ShortcutTarget(true) as unknown as EventTarget,
    { key: "b", code: "KeyB" },
  );

  shortcuts.handleWorkbenchShortcut(event);

  assert.deepEqual(toggled, ["left"]);
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
