import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinGitProjectRefresh } from "./git-panel-refresh-policy";

function activeRequest(loadsDetails: boolean) {
  return {
    reposRequestInFlight: true,
    activeRequestLoadsDetails: loadsDetails,
  };
}

describe("Git project refresh request policy", () => {
  it("keeps an active discovery-only request lightweight", () => {
    const state = activeRequest(false);

    assert.equal(joinGitProjectRefresh(state, false), true);
    assert.equal(state.activeRequestLoadsDetails, false);
  });

  it("does not join or mutate when no request is active", () => {
    const state = {
      reposRequestInFlight: false,
      activeRequestLoadsDetails: false,
    };

    assert.equal(joinGitProjectRefresh(state, true), false);
    assert.equal(state.activeRequestLoadsDetails, false);
  });

  it("promotes an active discovery request when the panel needs details", () => {
    const state = activeRequest(false);

    assert.equal(joinGitProjectRefresh(state, true), true);
    assert.equal(state.activeRequestLoadsDetails, true);
  });

  it("does not demote an active detail request", () => {
    const state = activeRequest(true);

    assert.equal(joinGitProjectRefresh(state, false), true);
    assert.equal(state.activeRequestLoadsDetails, true);
  });
});
