import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettingsPageId,
  pagesByScope,
  resolveSettingsPageId,
  resolveSettingsTarget,
  settingsPageDetail,
  settingsNavLayout,
  settingsPageIds,
  settingsScopeForPage,
  type SettingsRedirect,
} from "./settings-page-data";

describe("settings page registry", () => {
  it("groups the nav as approved", () => {
    assert.deepEqual(
      settingsNavLayout.map((group) => [group.title, group.pages]),
      [
        ["Agent", ["general", "agents", "sub-agents", "permission-rules"]],
        [
          "Capabilities",
          ["tools", "skills", "mcp-servers", "extensions", "accounts"],
        ],
        ["AI", ["providers", "models"]],
        [
          "App",
          [
            "workbench",
            "notifications",
            "shortcuts",
            "voice",
            "titles",
            "suggestions",
          ],
        ],
        ["Access", ["remote", "devices"]],
        ["System", ["storage", "background-jobs", "system", "about"]],
      ],
    );
  });

  it("lists only a scope's own pages", () => {
    assert.deepEqual(settingsPageIds("project"), [
      "general",
      "agents",
      "sub-agents",
      "permission-rules",
      "tools",
      "skills",
      "mcp-servers",
      "extensions",
      "suggestions",
    ]);
  });

  it("defines a page with sections for every nav entry", () => {
    for (const kind of ["user", "project"] as const)
      for (const id of settingsPageIds(kind))
        assert.ok(
          pagesByScope[kind][id]?.sections.length,
          `${kind}/${id} has no sections`,
        );
  });

  it("sends stale or foreign page ids to the scope default", () => {
    for (const old of [
      "agent-profiles",
      "profiles",
      "transcription",
      "permissions",
    ])
      assert.equal(
        resolveSettingsPageId("user", old),
        defaultSettingsPageId("user"),
      );
    assert.equal(resolveSettingsPageId("project", "providers"), "general");
    // The Trust page is gone: each item is decided on its own page.
    assert.equal(resolveSettingsPageId("project", "trust"), "general");
    assert.equal(resolveSettingsPageId("user", undefined), "general");
  });
});

describe("settings deep-link targets", () => {
  it("keeps user pages in the user scope while a project is open", () => {
    // Links to Devices or Notifications used to land on project General.
    for (const pageId of ["devices", "notifications", "providers"]) {
      assert.equal(settingsScopeForPage(true, pageId), "user");
    }
    assert.equal(settingsScopeForPage(true, undefined), "project");
    assert.equal(settingsScopeForPage(false, "general"), "user");
  });

  const redirects: SettingsRedirect[] = [
    {
      from: { pageId: "integrations", section: "tavily-accounts" },
      to: { pageId: "general", item: "web", section: "accounts" },
    },
    { from: { pageId: "integrations" }, to: { pageId: "general" } },
    { from: { pageId: "tools" }, to: { pageId: "nowhere" } },
  ];

  it("sends old integrations targets to the Extensions page", () => {
    assert.deepEqual(
      resolveSettingsTarget("project", { pageId: "integrations" }),
      {
        pageId: "extensions",
      },
    );
  });

  it("maps old targets to a page, item and section when enabled", () => {
    const options = { redirects, enabled: true };
    assert.deepEqual(
      resolveSettingsTarget(
        "user",
        { pageId: "integrations", section: "tavily-accounts" },
        options,
      ),
      { pageId: "general", section: "accounts" },
    );
    assert.deepEqual(
      resolveSettingsTarget(
        "user",
        { pageId: "integrations", section: "other" },
        options,
      ),
      { pageId: "general", section: "other" },
    );
  });

  it("ignores redirects whose destination is not in the scope", () => {
    assert.deepEqual(
      resolveSettingsTarget(
        "user",
        { pageId: "tools" },
        {
          redirects,
          enabled: true,
        },
      ),
      { pageId: "tools" },
    );
  });

  it("drops items for pages without a detail and unknown pages fall back", () => {
    assert.equal(settingsPageDetail("user", "tools"), undefined);
    assert.deepEqual(
      resolveSettingsTarget("user", { pageId: "tools", item: "x" }),
      { pageId: "tools" },
    );
    assert.deepEqual(
      resolveSettingsTarget("user", { pageId: "gone", item: "x" }),
      { pageId: "general" },
    );
  });
});
