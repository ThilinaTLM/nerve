import { atlassianMethods } from "./shared/defaults.js";
import { confluenceMethods } from "./confluence/methods.js";
import { jiraMethods } from "./jira/methods.js";
import type { ExtensionManifest } from "../../manifest-types.js";
import {
  ATLASSIAN_DTS_TYPES,
  CONFLUENCE_DTS_TYPES,
  JIRA_DTS_TYPES,
} from "./declarations.js";

/** Jira and Confluence behind one Atlassian account; the `jira` and `confluence` switches enable each namespace. */
export const atlassianExtension: ExtensionManifest = {
  id: "atlassian",
  name: "Atlassian",
  description: "Jira and Confluence through one Atlassian account.",
  source: "builtin",
  icon: "layers",
  contributes: {
    tools: [
      "jira_search_users",
      "jira_search_issues",
      "jira_get_issue",
      "jira_get_project",
      "jira_search_boards",
      "jira_get_board",
      "jira_get_sprint",
      "jira_download_attachment",
      "jira_create_issue",
      "jira_update_issue",
      "jira_manage_comment",
      "jira_manage_worklog",
      "jira_manage_issue_link",
      "jira_manage_attachment",
      "jira_manage_sprint",
      "jira_manage_backlog",
      "jira_transition_issue",
      "confluence_search_spaces",
      "confluence_search_pages",
      "confluence_get_page",
      "confluence_download_page",
      "confluence_create_page",
      "confluence_update_page",
      "confluence_manage_comment",
      "confluence_manage_page",
      "confluence_manage_label",
      "confluence_manage_restriction",
      "confluence_manage_attachment",
    ],
    sdk: [
      {
        id: "atlassian",
        summary: "site, default project/space and current user",
        rules: [
          "Write to Jira and Confluence only on explicit user request; start with `await atlassian.defaults()`.",
        ],
        methods: atlassianMethods,
        types: ATLASSIAN_DTS_TYPES,
        docs: [
          {
            id: "atlassian/project-knowledge",
            whenToRead:
              "after exploring a Jira project or Confluence space, to save what you learned as a skill",
            file: "project-knowledge.md",
          },
        ],
      },
      {
        id: "jira",
        enabledBy: "jira",
        summary: "issues, sprints, comments; bounded JQL",
        rules: [
          "Text is Markdown; methods take `key`; JQL needs a restriction (`project = X AND …`).",
        ],
        methods: jiraMethods,
        types: JIRA_DTS_TYPES,
        docs: [
          {
            id: "jira/workflows",
            whenToRead: "before creating or updating issues",
            file: "jira-workflows.md",
          },
          {
            id: "jira/raw",
            whenToRead: "when no method covers the task (`jira.request`)",
            file: "jira-raw.md",
          },
        ],
      },
      {
        id: "confluence",
        enabledBy: "confluence",
        summary: "pages; bodies are Markdown or `storage.*` builders",
        rules: [
          'Methods take `id`. Edit with `body: "storage"` and the `version` you read (`CONFLICT` if newer).',
          "CQL search lags after a create; use `pages.get({ title })` for exact titles.",
        ],
        methods: confluenceMethods,
        types: CONFLUENCE_DTS_TYPES,
        docs: [
          {
            id: "confluence/writing",
            whenToRead: "before writing or editing a page",
            file: "confluence-writing.md",
          },
          {
            id: "confluence/raw",
            whenToRead:
              "when no method covers the task (`confluence.request`, restrictions)",
            file: "confluence-raw.md",
          },
        ],
      },
      {
        id: "storage",
        enabledBy: "confluence",
        summary: "builders for Confluence storage-format bodies",
        methods: [],
        types: "",
        docs: [
          {
            id: "storage/builders",
            whenToRead:
              "before building page bodies with panels, tables, macros or images",
            file: "storage.md",
          },
        ],
      },
    ],
  },
};
