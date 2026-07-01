import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
  executeTool,
  hasDangerousCommandPattern,
  hasShellControlOperator,
  isAllowedPlanModeBashCommand,
  isKnownReadOnlyCommand,
  isLikelyLongRunningCommand,
  resolveToolPath,
  toolRiskForName,
} from "../src/index.js";

describe("public source exports", () => {
  it("keeps the intended @nervekit/tools source exports available", () => {
    assert.equal(typeof executeTool, "function");
    assert.equal(typeof resolveToolPath, "function");
    assert.equal(typeof toolRiskForName, "function");
    assert.equal(typeof coreToolDefinitionByName, "function");
    assert.equal(typeof hasDangerousCommandPattern, "function");
    assert.equal(typeof hasShellControlOperator, "function");
    assert.equal(typeof isAllowedPlanModeBashCommand, "function");
    assert.equal(typeof isKnownReadOnlyCommand, "function");
    assert.equal(typeof isLikelyLongRunningCommand, "function");
    assert.ok(coreToolDefinitions.length > 0);
    assert.ok(coreToolDescriptors.length > 0);
    assert.equal(toolRiskForName("read"), "read");
    assert.equal(toolRiskForName("ask_user"), "interaction");
    assert.equal(toolRiskForName("todos_set"), "interaction");
    assert.equal(toolRiskForName("todos_get"), "read");
    assert.equal(toolRiskForName("web_search"), "network");
    assert.equal(toolRiskForName("web_fetch"), "network");
    assert.equal(toolRiskForName("jira_search_users"), "network");
    assert.equal(toolRiskForName("jira_search_issues"), "network");
    assert.equal(toolRiskForName("jira_get_issue"), "network");
    assert.equal(toolRiskForName("jira_get_project"), "network");
    assert.equal(toolRiskForName("jira_create_issue"), "command");
    assert.equal(toolRiskForName("jira_update_issue"), "command");
    assert.equal(toolRiskForName("jira_add_comment"), "command");
    assert.equal(toolRiskForName("jira_transition_issue"), "command");
    assert.equal(toolRiskForName("confluence_search_spaces"), "network");
    assert.equal(toolRiskForName("confluence_search_pages"), "network");
    assert.equal(toolRiskForName("confluence_get_page"), "network");
    assert.equal(toolRiskForName("confluence_download_pages"), "network");
    assert.equal(toolRiskForName("confluence_create_page"), "command");
    assert.equal(toolRiskForName("confluence_update_page"), "command");
    assert.equal(toolRiskForName("confluence_publish_pages"), "command");
    assert.equal(toolRiskForName("confluence_upload_attachment"), "command");
  });
});
