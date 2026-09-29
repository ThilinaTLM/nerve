import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOBILE_STACK_LIMIT,
  initialMobileNavState,
  mobileHistoryDepth,
  mobileRouteForCenterTab,
  mobileRouteProjectId,
  parseMobileNav,
  popMobileRoute,
  popMobileRouteTo,
  pruneMissingRoutes,
  pushMobileRoute,
  replaceTopMobileRoute,
  resolveMobileHistoryPop,
  selectMobileTab,
  serializeMobileNav,
  topMobileRoute,
  type MobileRoute,
} from "./mobile-routes.js";

const project: MobileRoute = { kind: "project", projectId: "p1" };
const conversations: MobileRoute = { kind: "conversations", projectId: "p1" };
const chat: MobileRoute = {
  kind: "center",
  identity: { kind: "conversation", id: "c1" },
};

describe("mobile routes", () => {
  it("starts on the inbox root with empty stacks", () => {
    const state = initialMobileNavState();
    assert.equal(state.tab, "inbox");
    assert.equal(topMobileRoute(state), undefined);
    assert.equal(mobileHistoryDepth(state), 0);
  });

  it("pushes and pops within the active tab", () => {
    let state = selectMobileTab(initialMobileNavState(), "projects");
    state = pushMobileRoute(state, project);
    state = pushMobileRoute(state, conversations);
    assert.deepEqual(topMobileRoute(state), conversations);
    assert.equal(mobileHistoryDepth(state), 2);
    state = popMobileRoute(state);
    assert.deepEqual(topMobileRoute(state), project);
    state = popMobileRoute(popMobileRoute(state));
    assert.equal(topMobileRoute(state), undefined);
  });

  it("keeps each tab's stack while switching tabs", () => {
    let state = selectMobileTab(initialMobileNavState(), "projects");
    state = pushMobileRoute(state, project);
    state = selectMobileTab(state, "inbox");
    assert.equal(topMobileRoute(state), undefined);
    assert.equal(mobileHistoryDepth(state), 0);
    state = selectMobileTab(state, "projects");
    assert.deepEqual(topMobileRoute(state), project);
  });

  it("pops to root when the active tab is tapped again", () => {
    let state = selectMobileTab(initialMobileNavState(), "projects");
    state = pushMobileRoute(pushMobileRoute(state, project), conversations);
    state = selectMobileTab(state, "projects");
    assert.deepEqual(state.stacks.projects, []);
  });

  it("can push onto another tab and switch to it", () => {
    const state = pushMobileRoute(initialMobileNavState(), chat, "activity");
    assert.equal(state.tab, "activity");
    assert.deepEqual(state.stacks.activity, [chat]);
    assert.deepEqual(state.stacks.inbox, []);
  });

  it("truncates back to a route that is already in the stack", () => {
    let state = pushMobileRoute(initialMobileNavState(), project);
    state = pushMobileRoute(state, conversations);
    state = pushMobileRoute(state, chat);
    state = pushMobileRoute(state, { kind: "project", projectId: "p1" });
    assert.deepEqual(state.stacks.inbox, [project]);
  });

  it("caps the stack depth by dropping the oldest routes", () => {
    let state = initialMobileNavState();
    for (let index = 0; index < MOBILE_STACK_LIMIT + 3; index += 1) {
      state = pushMobileRoute(state, {
        kind: "files",
        projectId: "p1",
        path: `dir${index}`,
      });
    }
    assert.equal(state.stacks.inbox.length, MOBILE_STACK_LIMIT);
    assert.deepEqual(state.stacks.inbox[0], {
      kind: "files",
      projectId: "p1",
      path: "dir3",
    });
  });

  it("pops to an index and replaces the top route", () => {
    let state = pushMobileRoute(initialMobileNavState(), project);
    state = pushMobileRoute(state, conversations);
    state = pushMobileRoute(state, {
      kind: "center",
      identity: { kind: "pending-conversation", id: "tmp" },
    });
    state = replaceTopMobileRoute(state, chat);
    assert.deepEqual(state.stacks.inbox, [project, conversations, chat]);
    assert.deepEqual(popMobileRouteTo(state, 0).stacks.inbox, [project]);
    assert.deepEqual(popMobileRouteTo(state, -1).stacks.inbox, []);
  });

  it("reports the project a route depends on", () => {
    assert.equal(mobileRouteProjectId(conversations), "p1");
    assert.equal(
      mobileRouteProjectId({ kind: "files", projectId: "p2", path: "src" }),
      "p2",
    );
    assert.equal(mobileRouteProjectId(chat), undefined);
    assert.equal(mobileRouteProjectId({ kind: "settings" }), undefined);
    assert.equal(
      mobileRouteProjectId({ kind: "task", taskId: "t1", projectId: "p3" }),
      "p3",
    );
    assert.equal(
      mobileRouteProjectId({ kind: "task", taskId: "t1" }),
      undefined,
    );
  });

  it("keys task output routes by run so switching runs replaces the screen", () => {
    let state = pushMobileRoute(initialMobileNavState(), project);
    state = pushMobileRoute(state, {
      kind: "task",
      taskId: "t1",
      projectId: "p1",
    });
    state = replaceTopMobileRoute(state, {
      kind: "task",
      taskId: "t2",
      projectId: "p1",
    });
    assert.deepEqual(state.stacks.inbox, [
      project,
      { kind: "task", taskId: "t2", projectId: "p1" },
    ]);
  });

  it("maps center tabs onto native phone routes where they exist", () => {
    assert.deepEqual(
      mobileRouteForCenterTab({ kind: "settings", id: "settings" }),
      { kind: "settings" },
    );
    assert.deepEqual(
      mobileRouteForCenterTab({ kind: "settings", id: "settings" }, "models"),
      { kind: "settings-page", pageId: "models" },
    );
    assert.deepEqual(mobileRouteForCenterTab({ kind: "logs", id: "logs" }), {
      kind: "logs",
    });
    assert.deepEqual(mobileRouteForCenterTab({ kind: "file", id: "f1" }), {
      kind: "center",
      identity: { kind: "file", id: "f1" },
    });
  });
});

describe("mobile navigation persistence", () => {
  it("round-trips a navigation state", () => {
    let state = selectMobileTab(initialMobileNavState(), "projects");
    state = pushMobileRoute(state, project);
    state = pushMobileRoute(state, {
      kind: "files",
      projectId: "p1",
      path: "",
    });
    state = pushMobileRoute(state, chat, "activity");
    state = pushMobileRoute(state, { kind: "task", taskId: "t1" });
    assert.deepEqual(parseMobileNav(serializeMobileNav(state)), state);
  });

  it("falls back to the inbox for malformed data", () => {
    const initial = initialMobileNavState();
    assert.deepEqual(parseMobileNav(null), initial);
    assert.deepEqual(parseMobileNav("{not json"), initial);
    assert.deepEqual(parseMobileNav("[]"), initial);
    assert.deepEqual(
      parseMobileNav(JSON.stringify({ tab: "more", stacks: {} })),
      initial,
    );
  });

  it("drops unknown or incomplete routes and non-conversation center routes", () => {
    const restored = parseMobileNav(
      JSON.stringify({
        tab: "inbox",
        stacks: {
          inbox: [
            { kind: "project", projectId: "p1" },
            { kind: "unknown" },
            { kind: "note", projectId: "p1" },
            { kind: "center", identity: { kind: "file", id: "f1" } },
            {
              kind: "center",
              identity: { kind: "pending-conversation", id: "x" },
            },
            { kind: "center", identity: { kind: "conversation", id: "c1" } },
          ],
          projects: "nope",
        },
      }),
    );
    assert.deepEqual(restored.stacks.inbox, [project, chat]);
    assert.deepEqual(restored.stacks.projects, []);
  });

  it("caps restored stacks to the stack limit", () => {
    const inbox = Array.from(
      { length: MOBILE_STACK_LIMIT + 5 },
      (_, index) => ({
        kind: "files",
        projectId: "p1",
        path: `dir${index}`,
      }),
    );
    const restored = parseMobileNav(
      JSON.stringify({ tab: "inbox", stacks: { inbox } }),
    );
    assert.equal(restored.stacks.inbox.length, MOBILE_STACK_LIMIT);
  });

  it("cuts stacks at routes whose project or conversation is gone", () => {
    let state = pushMobileRoute(initialMobileNavState(), project);
    state = pushMobileRoute(state, conversations);
    state = pushMobileRoute(state, chat);
    state = pushMobileRoute(state, { kind: "context", conversationId: "c1" });
    state = pushMobileRoute(state, { kind: "settings" }, "activity");
    const kept = pruneMissingRoutes(state, {
      projectIds: new Set(["p1"]),
      conversationIds: new Set(),
    });
    assert.deepEqual(kept.stacks.inbox, [project, conversations]);
    assert.deepEqual(kept.stacks.activity, [{ kind: "settings" }]);
    const gone = pruneMissingRoutes(state, {
      projectIds: new Set(),
      conversationIds: new Set(["c1"]),
    });
    assert.deepEqual(gone.stacks.inbox, []);
    const unchanged = pruneMissingRoutes(state, {
      projectIds: new Set(["p1"]),
      conversationIds: new Set(["c1"]),
    });
    assert.equal(unchanged, state);
  });
});

describe("mobile history pops", () => {
  const settings: MobileRoute = { kind: "settings" };

  it("ignores pops that land on the shown depth", () => {
    assert.deepEqual(
      resolveMobileHistoryPop({ depth: 2, reached: 2, tab: "inbox" }),
      { kind: "ignore" },
    );
  });

  it("pops as many routes as history entries went back", () => {
    assert.deepEqual(
      resolveMobileHistoryPop({ depth: 3, reached: 1, tab: "inbox" }),
      { kind: "back", count: 2 },
    );
  });

  it("restores routes popped by back when going forward", () => {
    assert.deepEqual(
      resolveMobileHistoryPop({
        depth: 1,
        reached: 2,
        tab: "inbox",
        forward: { tab: "inbox", routes: [conversations, chat] },
      }),
      { kind: "forward", routes: [conversations], remaining: [chat] },
    );
  });

  it("steps back over forward entries it cannot restore", () => {
    assert.deepEqual(
      resolveMobileHistoryPop({ depth: 1, reached: 2, tab: "inbox" }),
      { kind: "rewind", count: 1 },
    );
    assert.deepEqual(
      resolveMobileHistoryPop({
        depth: 0,
        reached: 1,
        tab: "inbox",
        forward: { tab: "activity", routes: [settings] },
      }),
      { kind: "rewind", count: 1 },
    );
  });
});
