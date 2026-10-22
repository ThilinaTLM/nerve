import assert from "node:assert/strict";
import { it } from "node:test";
import {
  capabilityToolGroupsFor,
  capabilityToolSummary,
} from "./capability-tool-labels";
import {
  capabilityToolSettingsFromSettings,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";

it("keeps web search/fetch and Jira/Confluence independently controllable", () => {
  const groups = capabilityToolGroupsFor([
    "web_search",
    "web_fetch",
    "jira",
    "confluence",
  ]);
  assert.deepEqual(
    groups.map((group) => group.names),
    [["web_search"], ["web_fetch"], ["jira"], ["confluence"]],
  );
});

it("summaries only expose safe effective configuration fields", () => {
  const selection: CapabilitySelection = {
    disabledTools: [],
    toolProfiles: {},
    toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
    disabledFileSkills: [],
    enabledNerveSkills: [],
    enabledAgentBrowserSkills: [],
  };
  selection.toolSettings.kroki_export.url =
    "https://user:secret@example.test/private-token";
  assert.equal(
    capabilityToolSummary(selection, "kroki_export"),
    "Diagram server configured",
  );
  assert.equal(capabilityToolSummary(selection, "jira"), undefined);
  selection.toolSettings.python_exec.interpreterPath = "/usr/bin/python3";
  assert.equal(
    capabilityToolSummary(selection, "python_exec"),
    "/usr/bin/python3",
  );
});
