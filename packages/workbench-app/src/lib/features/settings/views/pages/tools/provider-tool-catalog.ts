export type ProviderToolGroup = {
  id: "jira" | "confluence";
  label: string;
  description: string;
  tools: { name: string; description: string }[];
};

export const providerToolGroups: ProviderToolGroup[] = [
  {
    id: "jira",
    label: "Jira",
    description: "Search and manage Jira Cloud issues.",
    tools: [
      { name: "jira_search_issues", description: "Search Jira Cloud issues." },
      {
        name: "jira_get_issue",
        description: "Fetch a Jira issue and its details.",
      },
      { name: "jira_create_issue", description: "Create a Jira issue." },
      { name: "jira_update_issue", description: "Update a Jira issue." },
      {
        name: "jira_manage_comment",
        description: "Create, update, or delete issue comments.",
      },
      {
        name: "jira_manage_worklog",
        description: "Create, update, or delete issue worklogs.",
      },
      {
        name: "jira_manage_issue_link",
        description: "Create or delete issue links.",
      },
      {
        name: "jira_manage_attachment",
        description: "Upload or delete issue attachments.",
      },
      {
        name: "jira_transition_issue",
        description: "Execute Jira workflow transitions.",
      },
      { name: "jira_search_users", description: "Find Jira users." },
      { name: "jira_get_project", description: "Fetch Jira project metadata." },
      {
        name: "jira_search_boards",
        description: "Search Jira Software boards.",
      },
      { name: "jira_get_board", description: "Fetch a Jira board." },
      { name: "jira_get_sprint", description: "Fetch a Jira sprint." },
      { name: "jira_manage_sprint", description: "Manage Jira sprints." },
      { name: "jira_manage_backlog", description: "Move or rank Jira issues." },
      {
        name: "jira_download_attachment",
        description: "Download a Jira attachment.",
      },
    ],
  },
  {
    id: "confluence",
    label: "Confluence",
    description: "Search and manage Confluence Cloud content.",
    tools: [
      {
        name: "confluence_search_spaces",
        description: "Find Confluence spaces.",
      },
      {
        name: "confluence_search_pages",
        description: "Find Confluence pages.",
      },
      { name: "confluence_get_page", description: "Fetch a Confluence page." },
      {
        name: "confluence_download_page",
        description: "Download a Confluence page.",
      },
      {
        name: "confluence_create_page",
        description: "Create a Confluence page.",
      },
      {
        name: "confluence_update_page",
        description: "Update a Confluence page.",
      },
      {
        name: "confluence_manage_comment",
        description: "Manage Confluence comments.",
      },
      {
        name: "confluence_manage_page",
        description: "Trash, restore, or purge a page.",
      },
      {
        name: "confluence_manage_label",
        description: "Add or remove page labels.",
      },
      {
        name: "confluence_manage_restriction",
        description: "Manage page restrictions.",
      },
      {
        name: "confluence_manage_attachment",
        description: "Manage page attachments.",
      },
    ],
  },
];
