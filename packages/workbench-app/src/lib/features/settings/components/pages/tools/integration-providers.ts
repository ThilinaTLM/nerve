import type { ToolSummary } from "./tool-catalog";

export type IntegrationProviderId = "jira" | "confluence";

export type IntegrationFieldKey = "siteUrl" | "email" | "token" | "extra";

export type IntegrationFieldDef = {
  key: IntegrationFieldKey;
  label: string;
  placeholder: string;
  type: "text" | "email" | "password";
  required: boolean;
  secret?: boolean;
};

export type IntegrationDraft = Record<IntegrationFieldKey, string>;

export type IntegrationProviderDef = {
  id: IntegrationProviderId;
  label: string;
  description: string;
  /** Auth provider id holding the API token. */
  providerId: string;
  /** Settings key under `tools`. */
  settingsKey: IntegrationProviderId;
  /** Settings key for the provider-specific optional default. */
  extraSettingsKey: "defaultProjectKey" | "defaultSpaceKey";
  tools: ToolSummary[];
  fields: IntegrationFieldDef[];
  normalizeSiteUrl: (value: string) => string | undefined;
  docsHint: string;
};

export type IntegrationConfigurationStatus =
  | "connected"
  | "incomplete"
  | "unconfigured";

function baseNormalizeSiteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return undefined;
  }
  if (parsed.hostname.startsWith(".") || parsed.hostname.endsWith(".")) {
    return undefined;
  }
  if (parsed.search || parsed.hash) return undefined;

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

export function normalizeJiraSiteUrl(value: string): string | undefined {
  return baseNormalizeSiteUrl(value);
}

export function normalizeConfluenceSiteUrl(value: string): string | undefined {
  return baseNormalizeSiteUrl(value)?.replace(/\/wiki$/i, "");
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const jiraIntegration: IntegrationProviderDef = {
  id: "jira",
  label: "Jira",
  description:
    "Jira Cloud tools for ticket search, creation, updates, comments, and workflow transitions.",
  providerId: "jira",
  settingsKey: "jira",
  extraSettingsKey: "defaultProjectKey",
  normalizeSiteUrl: normalizeJiraSiteUrl,
  docsHint:
    "Create an Atlassian API token for your account, then paste it here.",
  fields: [
    {
      key: "siteUrl",
      label: "Jira site URL",
      placeholder: "https://example.atlassian.net",
      type: "text",
      required: true,
    },
    {
      key: "email",
      label: "Atlassian account email",
      placeholder: "name@example.com",
      type: "email",
      required: true,
    },
    {
      key: "token",
      label: "Jira API token",
      placeholder: "Paste your Jira API token",
      type: "password",
      required: true,
      secret: true,
    },
    {
      key: "extra",
      label: "Default project key",
      placeholder: "Optional, e.g. PROJ",
      type: "text",
      required: false,
    },
  ],
  tools: [
    {
      name: "jira_search_users",
      description: "Find users and accountIds for assignments.",
    },
    {
      name: "jira_search_issues",
      description: "Search issues with JQL and saved raw JSON.",
    },
    {
      name: "jira_get_issue",
      description:
        "Fetch issues with comments, transitions, worklogs, changelog, links, and metadata.",
    },
    {
      name: "jira_get_project",
      description:
        "Fetch project, issue type, create-field, priority, resolution, and field metadata.",
    },
    {
      name: "jira_create_issue",
      description: "Create tasks, stories, bugs, epics, or subtasks.",
    },
    {
      name: "jira_update_issue",
      description: "Update common issue fields and raw Jira fields.",
    },
    {
      name: "jira_add_comment",
      description: "Add comments from plain text or ADF.",
    },
    {
      name: "jira_transition_issue",
      description: "Discover or execute workflow transitions.",
    },
  ],
};

export const confluenceIntegration: IntegrationProviderDef = {
  id: "confluence",
  label: "Confluence",
  description:
    "Confluence Cloud tools for space and page search, downloads, edits, and attachments.",
  providerId: "confluence",
  settingsKey: "confluence",
  extraSettingsKey: "defaultSpaceKey",
  normalizeSiteUrl: normalizeConfluenceSiteUrl,
  docsHint:
    "Create an Atlassian API token for your account, then paste it here. A trailing /wiki path is removed automatically.",
  fields: [
    {
      key: "siteUrl",
      label: "Confluence site URL",
      placeholder: "https://example.atlassian.net",
      type: "text",
      required: true,
    },
    {
      key: "email",
      label: "Atlassian account email",
      placeholder: "name@example.com",
      type: "email",
      required: true,
    },
    {
      key: "token",
      label: "Confluence API token",
      placeholder: "Paste your Confluence API token",
      type: "password",
      required: true,
      secret: true,
    },
    {
      key: "extra",
      label: "Default space key",
      placeholder: "Optional, e.g. DOCS",
      type: "text",
      required: false,
    },
  ],
  tools: [
    {
      name: "confluence_search_spaces",
      description: "List or resolve visible Confluence spaces.",
    },
    {
      name: "confluence_search_pages",
      description: "Find pages with filters, CQL, or text search.",
    },
    {
      name: "confluence_get_page",
      description:
        "Fetch a page with storage body, metadata, children, and attachments.",
    },
    {
      name: "confluence_download_pages",
      description:
        "Download pages into editable JSONL and storage XML artifacts.",
    },
    {
      name: "confluence_create_page",
      description: "Create pages from storage XML, body files, or page rows.",
    },
    {
      name: "confluence_update_page",
      description: "Update pages with version-conflict protection.",
    },
    {
      name: "confluence_publish_pages",
      description: "Publish edited JSONL page rows.",
    },
    {
      name: "confluence_upload_attachment",
      description: "Upload or update media and file attachments.",
    },
  ],
};

export const integrationProviders: IntegrationProviderDef[] = [
  jiraIntegration,
  confluenceIntegration,
];

/**
 * Field-level problems shown in the dialog. These never block saving: partial
 * configuration stays savable, matching the existing behaviour.
 */
export function integrationFieldErrors(
  provider: IntegrationProviderDef,
  draft: Partial<IntegrationDraft>,
  options: { tokenConfigured: boolean },
): Partial<Record<IntegrationFieldKey, string>> {
  const errors: Partial<Record<IntegrationFieldKey, string>> = {};
  const siteUrlRaw = (draft.siteUrl ?? "").trim();
  if (siteUrlRaw && !provider.normalizeSiteUrl(siteUrlRaw)) {
    errors.siteUrl = "Enter a valid site URL.";
  }
  const email = (draft.email ?? "").trim();
  if (email && !emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!options.tokenConfigured && !(draft.token ?? "").trim()) {
    errors.token = `An API token is required before ${provider.label} tools can be enabled.`;
  }
  return errors;
}

/** Enablement gate: normalized URL + email + a stored token. */
export function canEnableIntegration(options: {
  siteUrl?: string;
  email?: string;
  tokenConfigured: boolean;
}): boolean {
  return Boolean(options.siteUrl && options.email && options.tokenConfigured);
}

export function integrationConfigurationStatus(options: {
  siteUrl?: string;
  email?: string;
  tokenConfigured: boolean;
}): IntegrationConfigurationStatus {
  if (canEnableIntegration(options)) return "connected";
  if (options.siteUrl || options.email || options.tokenConfigured) {
    return "incomplete";
  }
  return "unconfigured";
}
