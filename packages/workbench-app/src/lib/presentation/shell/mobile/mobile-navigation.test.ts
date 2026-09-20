import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeMobileDetail,
  closeMobileDetail,
  initialMobileNavState,
  openMobileCenterDetail,
  openMobilePanelDetail,
  openMobileProjectsDetail,
  retainSingleCenterDetail,
  selectMobileTab,
} from "./mobile-navigation.js";

describe("mobile navigation", () => {
  it("starts on the inbox with no detail", () => {
    const state = initialMobileNavState();
    assert.equal(state.tab, "inbox");
    assert.equal(activeMobileDetail(state), undefined);
  });

  it("keeps a detail per tab so switching tabs does not lose the reader's place", () => {
    let state = openMobileCenterDetail(initialMobileNavState(), "chats");
    state = openMobilePanelDetail(state, "git");
    assert.equal(state.tab, "code");
    assert.deepEqual(activeMobileDetail(state), {
      kind: "panel",
      viewId: "git",
    });

    state = selectMobileTab(state, "chats");
    assert.deepEqual(activeMobileDetail(state), { kind: "center" });
  });

  it("pops the detail when the active tab is tapped again", () => {
    const opened = openMobilePanelDetail(initialMobileNavState(), "files");
    const popped = selectMobileTab(opened, "code");
    assert.equal(activeMobileDetail(popped), undefined);
    assert.equal(popped.tab, "code");
    assert.equal(selectMobileTab(popped, "code"), popped);
  });

  it("closes only the active tab's detail", () => {
    let state = openMobileCenterDetail(initialMobileNavState(), "chats");
    state = openMobilePanelDetail(state, "files");
    state = closeMobileDetail(state);
    assert.equal(activeMobileDetail(state), undefined);
    assert.deepEqual(state.details.chats, { kind: "center" });
  });

  it("opens the project picker as a detail on the active tab", () => {
    let state = selectMobileTab(initialMobileNavState(), "chats");
    state = openMobileProjectsDetail(state);
    assert.deepEqual(activeMobileDetail(state), { kind: "projects" });
    state = closeMobileDetail(state);
    assert.equal(activeMobileDetail(state), undefined);
  });

  it("drops stale center details parked on other tabs", () => {
    let state = openMobileCenterDetail(initialMobileNavState(), "chats");
    state = openMobilePanelDetail(state, "files");
    state = openMobileCenterDetail(state, "inbox");
    const retained = retainSingleCenterDetail(state);
    assert.deepEqual(retained.details, {
      inbox: { kind: "center" },
      code: { kind: "panel", viewId: "files" },
    });
  });
});
