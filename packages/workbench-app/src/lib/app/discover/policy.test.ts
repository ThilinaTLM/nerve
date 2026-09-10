import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverNewsCatalog } from "./content/news.js";
import { discoverTipsCatalog } from "./content/tips.js";
import type { DiscoverNewsEntry } from "./content/entries.js";
import {
  DISCOVER_AUTO_OPEN_LIMIT,
  buildDiscoverSections,
  countAutoOpen,
  decideDiscoverAutoOpen,
  discoverBadge,
  exhaustAutoOpen,
  resolveNews,
  unreadNewsCount,
  type DiscoverAutoOpenState,
} from "./policy.js";
import { guideCatalog } from "./guides/catalog.js";
import { resolveGuides } from "./guides/catalog-policy.js";

const noSignals = {
  "atlassian-ready": false,
  "project-open": false,
  "provider-ready": false,
  "voice-ready": false,
  "web-search-ready": false,
};

const news: DiscoverNewsEntry[] = [
  {
    id: "current-featured",
    version: 1,
    releasedIn: "0.29.0",
    featured: true,
    title: "Featured",
    summary: "Featured summary",
  },
  {
    id: "current-plain",
    version: 2,
    releasedIn: "0.29.0",
    title: "Plain",
    summary: "Plain summary",
  },
  {
    id: "older",
    version: 1,
    releasedIn: "0.28.0",
    title: "Older",
    summary: "Older summary",
  },
];

function sectionsFor(seen: Record<string, number>, appVersion?: string) {
  return buildDiscoverSections({
    guides: resolveGuides(
      guideCatalog,
      { provider: 1, workbench: 1 },
      noSignals,
    ),
    news: resolveNews(news, seen),
    tips: discoverTipsCatalog,
    appVersion,
  });
}

describe("Discover sections", () => {
  it("splits news by the running release and lifts the featured entry", () => {
    const sections = sectionsFor({}, "v0.29.0");
    assert.equal(sections.news.featured?.id, "current-featured");
    assert.deepEqual(
      sections.news.current.map((entry) => entry.id),
      ["current-plain"],
    );
    assert.deepEqual(
      sections.news.archive.map((entry) => entry.id),
      ["older"],
    );
    assert.equal(sections.news.unreadCount, 3);
  });

  it("treats every entry as current when the app version is unknown", () => {
    const sections = sectionsFor({}, undefined);
    assert.equal(sections.news.archive.length, 0);
    assert.equal(sections.news.current.length, 2);
  });

  it("marks entries read once the stored version catches up", () => {
    const sections = sectionsFor(
      { "current-featured": 1, "current-plain": 1 },
      "0.29.0",
    );
    assert.equal(sections.news.featured?.unread, false);
    assert.equal(sections.news.current[0]?.unread, true);
    assert.equal(sections.news.unreadCount, 2);
  });

  it("orders pending setup by priority and collapses completed setup", () => {
    const sections = sectionsFor({}, "0.29.0");
    assert.equal(sections.setup.pending[0]?.id, "open-project");
    assert.equal(
      sections.setup.pending.some((guide) => guide.id === "provider"),
      false,
    );
    assert.equal(
      sections.setup.completed.some((guide) => guide.id === "provider"),
      true,
    );
    assert.equal(
      sections.setup.completedCount + sections.setup.pending.length,
      sections.setup.totalCount,
    );
    assert.equal(
      sections.setup.pending.some((guide) => guide.category !== "setup"),
      false,
    );
    assert.equal(
      sections.walkthroughs.some((guide) => guide.id === "workbench"),
      true,
    );
  });
});

describe("Discover badge", () => {
  it("counts unread news, falls back to a dot, then to nothing", () => {
    assert.deepEqual(
      discoverBadge({ unreadNewsCount: 3, pendingSetupCount: 5 }),
      { kind: "count", value: 3 },
    );
    assert.deepEqual(
      discoverBadge({ unreadNewsCount: 0, pendingSetupCount: 5 }),
      { kind: "dot" },
    );
    assert.deepEqual(
      discoverBadge({ unreadNewsCount: 0, pendingSetupCount: 0 }),
      { kind: "none" },
    );
  });

  it("counts unread news entries", () => {
    assert.equal(unreadNewsCount(resolveNews(news, {})), 3);
    assert.equal(
      unreadNewsCount(resolveNews(news, { "current-plain": 2, older: 1 })),
      1,
    );
  });
});

describe("Discover auto-open", () => {
  const base = {
    ready: true,
    alreadyConsidered: false,
    firstRun: false,
    appVersion: "0.29.0",
    unreadForCurrentVersion: 2,
    autoOpen: {
      enabled: true,
      version: "0.28.0",
      count: 2,
    } as DiscoverAutoOpenState,
  };

  it("opens once on a first run even without news", () => {
    assert.deepEqual(
      decideDiscoverAutoOpen({
        ...base,
        firstRun: true,
        unreadForCurrentVersion: 0,
        appVersion: undefined,
      }),
      { open: true, reason: "first-run" },
    );
  });

  it("opens for a new release with unread news", () => {
    assert.deepEqual(decideDiscoverAutoOpen(base), {
      open: true,
      reason: "release",
    });
  });

  it("stays closed when startup is not ready, already considered, or disabled", () => {
    assert.deepEqual(decideDiscoverAutoOpen({ ...base, ready: false }), {
      open: false,
    });
    assert.deepEqual(
      decideDiscoverAutoOpen({ ...base, alreadyConsidered: true }),
      { open: false },
    );
    assert.deepEqual(
      decideDiscoverAutoOpen({
        ...base,
        firstRun: true,
        autoOpen: { enabled: false, count: 0 },
      }),
      { open: false },
    );
  });

  it("stops after the per-release budget is spent or the news is read", () => {
    const prompted = {
      ...base,
      autoOpen: {
        enabled: true,
        version: "0.29.0",
        count: DISCOVER_AUTO_OPEN_LIMIT,
      },
    };
    assert.deepEqual(decideDiscoverAutoOpen(prompted), { open: false });
    assert.deepEqual(
      decideDiscoverAutoOpen({ ...base, unreadForCurrentVersion: 0 }),
      { open: false },
    );
    assert.deepEqual(
      decideDiscoverAutoOpen({ ...base, appVersion: undefined }),
      {
        open: false,
      },
    );
  });

  it("restarts the budget on a version change and exhausts it when read", () => {
    const spent = countAutoOpen(
      { enabled: true, version: "0.28.0", count: 2 },
      "v0.29.0",
    );
    assert.deepEqual(spent, { enabled: true, version: "0.29.0", count: 1 });
    assert.deepEqual(countAutoOpen(spent, "0.29.0").count, 2);
    assert.deepEqual(exhaustAutoOpen(spent, "0.29.0"), {
      enabled: true,
      version: "0.29.0",
      count: DISCOVER_AUTO_OPEN_LIMIT,
    });
    const exhausted = exhaustAutoOpen(spent, "0.29.0");
    assert.equal(exhaustAutoOpen(exhausted, "0.29.0"), exhausted);
  });
});

describe("Discover news catalog", () => {
  it("keeps ids unique, summaries single-line, and one feature per release", () => {
    const ids = new Set<string>();
    const featuredByRelease = new Map<string, number>();
    for (const entry of discoverNewsCatalog) {
      assert.equal(ids.has(entry.id), false, `duplicate id ${entry.id}`);
      ids.add(entry.id);
      assert.match(entry.releasedIn, /^\d+\.\d+\.\d+/);
      assert.equal(entry.summary.includes("\n"), false);
      assert.equal(entry.summary.length <= 110, true, entry.id);
      if (!entry.featured) continue;
      const count = (featuredByRelease.get(entry.releasedIn) ?? 0) + 1;
      featuredByRelease.set(entry.releasedIn, count);
      assert.equal(
        count,
        1,
        `multiple featured entries in ${entry.releasedIn}`,
      );
    }
  });

  it("keeps tip ids unique and summaries single-line", () => {
    const ids = new Set<string>();
    for (const tip of discoverTipsCatalog) {
      assert.equal(ids.has(tip.id), false, `duplicate id ${tip.id}`);
      ids.add(tip.id);
      assert.equal(tip.summary.includes("\n"), false);
    }
  });
});
