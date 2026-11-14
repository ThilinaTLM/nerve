import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import { AtlassianSession, atlassianMethods } from "./shared/defaults.js";
import { testAtlassianAccount } from "./shared/connection-check.js";
import { methodTable } from "./shared/define-method.js";
import { ConfluenceSession } from "./confluence/session.js";
import { confluenceMethods } from "./confluence/methods.js";
import { JiraSession } from "./jira/session.js";
import { jiraMethods } from "./jira/methods.js";
import { STORAGE_PRELUDE } from "./storage/storage-helpers.js";
import {
  ATLASSIAN_DTS_TYPES,
  CONFLUENCE_DTS_TYPES,
  JIRA_DTS_TYPES,
} from "./declarations.js";

/** Jira and Confluence behind one Atlassian account; the `jira` and `confluence` switches enable each namespace. */
export const atlassianExtension = defineExtension({
  id: "atlassian",
  apiVersion: 1,
  name: "Atlassian",
  description: "Jira and Confluence through one Atlassian account.",
  icon: "layers",
  enabledByDefault: false,
  accounts: {
    atlassian: {
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
      auth: { scheme: "basic", user: "email" },
      origins: ["{siteUrl}"],
      test: testAtlassianAccount,
    },
  },
  settings: {
    version: 1,
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
  permissions: {
    network: [
      "https://*.atlassian.net",
      "https://api.media.atlassian.com",
      "{account.siteUrl}",
    ],
  },
  namespaces: [
    defineNamespace<AtlassianSession>({
      id: "atlassian",
      session: (ctx) => AtlassianSession.create(ctx),
      enabledBy: ["jira", "confluence"],
      requires: { account: "account" },
      summary: "site, default project/space and current user",
      rules: [
        "Write to Jira and Confluence only on explicit user request; start with `await atlassian.defaults()`.",
      ],
      methods: methodTable(atlassianMethods),
      types: ATLASSIAN_DTS_TYPES,
      docs: [
        {
          id: "atlassian/project-knowledge",
          whenToRead:
            "after exploring a Jira project or Confluence space, to save what you learned as a skill",
          file: "docs/project-knowledge.md",
        },
      ],
    }),
    defineNamespace<JiraSession>({
      id: "jira",
      session: (ctx) => JiraSession.create(ctx),
      enabledBy: "jira",
      requires: { account: "account" },
      summary: "issues, sprints, comments; bounded JQL",
      rules: [
        "Text is Markdown; methods take `key`; JQL needs a restriction (`project = X AND …`).",
      ],
      methods: methodTable(jiraMethods),
      types: JIRA_DTS_TYPES,
      docs: [
        {
          id: "jira/workflows",
          whenToRead: "before creating or updating issues",
          file: "docs/jira-workflows.md",
        },
        {
          id: "jira/raw",
          whenToRead: "when no method covers the task (`jira.request`)",
          file: "docs/jira-raw.md",
        },
      ],
    }),
    defineNamespace<ConfluenceSession>({
      id: "confluence",
      session: (ctx) => ConfluenceSession.create(ctx),
      enabledBy: "confluence",
      requires: { account: "account" },
      summary: "pages; bodies are Markdown or `storage.*` builders",
      rules: [
        'Methods take `id`. Edit with `body: "storage"` and the `version` you read (`CONFLICT` if newer).',
        "CQL search lags after a create; use `pages.get({ title })` for exact titles.",
      ],
      methods: methodTable(confluenceMethods),
      types: CONFLUENCE_DTS_TYPES,
      docs: [
        {
          id: "confluence/writing",
          whenToRead: "before writing or editing a page",
          file: "docs/confluence-writing.md",
        },
        {
          id: "confluence/raw",
          whenToRead:
            "when no method covers the task (`confluence.request`, restrictions)",
          file: "docs/confluence-raw.md",
        },
      ],
    }),
    defineNamespace({
      id: "storage",
      enabledBy: "confluence",
      requires: { account: "account" },
      helper: true,
      summary: "builders for Confluence storage-format bodies",
      methods: {},
      types: "",
      docs: [
        {
          id: "storage/builders",
          whenToRead:
            "before building page bodies with panels, tables, macros or images",
          file: "docs/storage.md",
        },
      ],
    }),
  ],
  prelude: STORAGE_PRELUDE,
});
