import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activateShellView,
  DEFAULT_DOCK_SIZES,
  defaultShellLayout,
  dockDescriptors,
  findViewDock,
  hideShellView,
  isDockVisible,
  moveShellView,
  normalizeShellLayout,
  setShellDockSize,
  showShellView,
  toggleShellDock,
} from "./shell-layout";
import type { PanelViewDescriptor, PanelViewIcon } from "./shell-types";

const icon = (() => null) as unknown as PanelViewIcon;

const descriptors: PanelViewDescriptor[] = [
  {
    id: "conversations",
    title: "Conversations",
    icon,
    defaultDock: "left",
    defaultOrder: 0,
    hideable: false,
  },
  { id: "git", title: "Git", icon, defaultDock: "right", defaultOrder: 0 },
  {
    id: "context",
    title: "Context",
    icon,
    defaultDock: "right",
    defaultOrder: 1,
  },
  { id: "notes", title: "Notes", icon, defaultDock: "right", defaultOrder: 2 },
  { id: "tasks", title: "Tasks", icon, defaultDock: "bottom", defaultOrder: 0 },
];

describe("defaultShellLayout", () => {
  it("places every descriptor in its default dock in default order", () => {
    const layout = defaultShellLayout(descriptors);
    assert.deepEqual(layout.docks.left.views, ["conversations"]);
    assert.deepEqual(layout.docks.right.views, ["git", "context", "notes"]);
    assert.deepEqual(layout.docks.bottom.views, ["tasks"]);
    assert.equal(layout.docks.right.activeViewId, "git");
    assert.deepEqual(layout.hidden, []);
    assert.equal(layout.docks.left.size, DEFAULT_DOCK_SIZES.left);
  });

  it("honours default collapsed docks", () => {
    const layout = defaultShellLayout(descriptors, { collapsed: ["bottom"] });
    assert.equal(layout.docks.bottom.collapsed, true);
    assert.equal(layout.docks.left.collapsed, false);
    assert.equal(isDockVisible(layout, "bottom"), false);
  });
});

describe("normalizeShellLayout", () => {
  it("returns the default layout for missing or malformed input", () => {
    const fallback = defaultShellLayout(descriptors);
    assert.deepEqual(normalizeShellLayout(undefined, descriptors), fallback);
    assert.deepEqual(normalizeShellLayout("nope", descriptors), fallback);
    assert.deepEqual(normalizeShellLayout([1, 2], descriptors), fallback);
    assert.deepEqual(normalizeShellLayout({}, descriptors), fallback);
  });

  it("drops unknown ids, appends new descriptors, and repairs the active view", () => {
    const layout = normalizeShellLayout(
      {
        version: 1,
        docks: {
          left: { views: ["ghost"], activeViewId: "ghost", size: 20 },
          right: {
            views: ["conversations"],
            activeViewId: "gone",
            size: 22,
            collapsed: false,
          },
          bottom: { views: [], size: 30, collapsed: false },
        },
        hidden: ["ghost"],
      },
      descriptors,
    );
    assert.deepEqual(layout.docks.left.views, []);
    assert.equal(layout.docks.left.collapsed, true);
    assert.deepEqual(layout.docks.right.views, [
      "conversations",
      "git",
      "context",
      "notes",
    ]);
    assert.equal(layout.docks.right.activeViewId, "conversations");
    assert.deepEqual(layout.docks.bottom.views, ["tasks"]);
    assert.deepEqual(layout.hidden, []);
  });

  it("adds a newly registered files view to its default left dock", () => {
    const files: PanelViewDescriptor = {
      id: "files",
      title: "Files",
      icon,
      defaultDock: "left",
      defaultOrder: -1,
    };
    const fresh = defaultShellLayout([...descriptors, files]);
    assert.deepEqual(fresh.docks.left.views, ["files", "conversations"]);

    const persisted = normalizeShellLayout(
      {
        version: 1,
        docks: {
          left: {
            views: ["conversations"],
            activeViewId: "conversations",
            size: 20,
          },
          right: { views: ["git", "context", "notes"], size: 22 },
          bottom: { views: ["tasks"], size: 30 },
        },
        hidden: [],
      },
      [...descriptors, files],
    );
    assert.deepEqual(persisted.docks.left.views, ["conversations", "files"]);
    assert.equal(persisted.docks.left.activeViewId, "conversations");
  });

  it("clamps out-of-range sizes", () => {
    const layout = normalizeShellLayout(
      {
        version: 1,
        docks: {
          left: { views: ["conversations"], size: 90 },
          right: { views: ["git"], size: -5 },
          bottom: { views: ["tasks"], size: Number.NaN },
        },
        hidden: [],
      },
      descriptors,
    );
    assert.equal(layout.docks.left.size, 34);
    assert.equal(layout.docks.right.size, 16);
    assert.equal(layout.docks.bottom.size, DEFAULT_DOCK_SIZES.bottom);
  });

  it("round-trips through serialization", () => {
    const layout = moveShellView(defaultShellLayout(descriptors), "git", {
      dock: "bottom",
      index: 0,
    });
    const restored = normalizeShellLayout(
      JSON.parse(JSON.stringify(layout)),
      descriptors,
    );
    assert.deepEqual(restored, layout);
  });
});

describe("moveShellView", () => {
  it("moves a view across docks and repairs the source dock", () => {
    const layout = moveShellView(defaultShellLayout(descriptors), "git", {
      dock: "bottom",
      index: 1,
    });
    assert.deepEqual(layout.docks.right.views, ["context", "notes"]);
    assert.equal(layout.docks.right.activeViewId, "context");
    assert.deepEqual(layout.docks.bottom.views, ["tasks", "git"]);
    assert.equal(layout.docks.bottom.activeViewId, "git");
    assert.equal(layout.docks.bottom.collapsed, false);
    assert.equal(findViewDock(layout, "git"), "bottom");
  });

  it("reorders within a dock at both boundaries", () => {
    const base = defaultShellLayout(descriptors);
    const toFront = moveShellView(base, "notes", { dock: "right", index: 0 });
    assert.deepEqual(toFront.docks.right.views, ["notes", "git", "context"]);
    const toBack = moveShellView(toFront, "notes", {
      dock: "right",
      index: 99,
    });
    assert.deepEqual(toBack.docks.right.views, ["git", "context", "notes"]);
  });

  it("ignores unknown views", () => {
    const base = defaultShellLayout(descriptors);
    assert.equal(
      moveShellView(base, "ghost", { dock: "left", index: 0 }),
      base,
    );
  });
});

describe("visibility and dock state", () => {
  it("round-trips hide and show while preserving dock membership", () => {
    const base = defaultShellLayout(descriptors);
    const hidden = hideShellView(base, "git");
    assert.deepEqual(hidden.hidden, ["git"]);
    assert.equal(hidden.docks.right.activeViewId, "context");
    assert.deepEqual(
      dockDescriptors(hidden, "right", descriptors).map((d) => d.id),
      ["context", "notes"],
    );
    const shown = showShellView(hidden, "git");
    assert.deepEqual(shown, base);
  });

  it("collapses a dock whose only view is hidden", () => {
    const layout = hideShellView(defaultShellLayout(descriptors), "tasks");
    assert.equal(layout.docks.bottom.collapsed, true);
    assert.equal(layout.docks.bottom.activeViewId, undefined);
  });

  it("activating a view expands its dock", () => {
    const collapsed = toggleShellDock(defaultShellLayout(descriptors), "right");
    assert.equal(collapsed.docks.right.collapsed, true);
    const active = activateShellView(collapsed, "notes");
    assert.equal(active.docks.right.collapsed, false);
    assert.equal(active.docks.right.activeViewId, "notes");
  });

  it("clamps dock resize", () => {
    const layout = setShellDockSize(defaultShellLayout(descriptors), "left", 3);
    assert.equal(layout.docks.left.size, 14);
  });
});
