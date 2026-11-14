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
  enabledByDefault: false,
  settingsVersion: 1,
  accounts: [
    {
      kind: "atlassian",
      label: "Atlassian account",
      fields: {
        name: { type: "string", label: "Name", maxLength: 128 },
        siteUrl: {
          type: "string",
          label: "Site URL",
          format: "url",
          placeholder: "https://acme.atlassian.net/",
        },
        email: { type: "string", label: "Email" },
        defaultProjectKey: { type: "string", label: "Default Jira project" },
        defaultSpaceKey: { type: "string", label: "Default Confluence space" },
      },
      secret: {
        label: "API token",
        help: "Create an API token in your Atlassian account settings.",
      },
      test: true,
    },
  ],
  settings: {
    fields: {
      account: {
        type: "account",
        kind: "atlassian",
        label: "Account",
        description: "The Atlassian account used for Jira and Confluence.",
      },
      jira: {
        type: "boolean",
        label: "Jira",
        description: "Offer the jira namespace.",
        default: false,
      },
      confluence: {
        type: "boolean",
        label: "Confluence",
        description: "Offer the confluence namespace.",
        default: false,
      },
    },
  },
  contributes: {
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
