import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppShortcuts } from "./app-shortcuts.svelte";

describe("app shortcuts", () => {
  it("stops only while the selected conversation is sending", () => {
    let sending = false;
    let aborts = 0;
    const shortcuts = createAppShortcuts({
      currentZoomLevel: () => 0,
      setUiZoomLevel: () => undefined,
      centerTabs: () => [],
      activeCenterTab: () => undefined,
      selectCenterTab: () => undefined,
      newConversation: () => undefined,
      openProjectPicker: () => undefined,
      closeCenterTab: () => undefined,
      closeCenterTabs: () => undefined,
      centerTabsExcept: () => [],
      refreshCenterTab: () => undefined,
      focusProjectSearch: () => undefined,
      hasConversationComposer: () => true,
      sending: () => sending,
      abortActiveRun: () => {
        aborts += 1;
      },
      composerEscape: () => undefined,
      toggleMic: () => undefined,
      selectedPermissionLevel: () => "autonomous",
      setComposerPermission: () => undefined,
      usableModels: () => [],
      selectedModelKey: () => "",
      selectedThinkingLevel: () => "off",
      setComposerThinkingLevel: () => undefined,
      selectedMode: () => "coding",
      setComposerMode: () => undefined,
    });

    assert.equal(shortcuts.runShortcutCommand("composer.stopRun"), false);
    assert.equal(aborts, 0);

    sending = true;
    assert.equal(shortcuts.runShortcutCommand("composer.stopRun"), true);
    assert.equal(aborts, 1);
  });
});
