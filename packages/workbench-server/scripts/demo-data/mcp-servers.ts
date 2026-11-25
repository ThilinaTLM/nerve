/**
 * The demo user's MCP servers and the tool lists Nerve caches for them. The seed saves the
 * entries through the Settings service and stores the lists in the tool index, so the page and
 * `mcp.tools.search` have tools to show without starting a server.
 */

type Tool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required });

const text = (description: string) => ({ type: "string", description });

export const DEMO_MCP_SERVERS = [
  {
    name: "github",
    entry: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${secret:github-token}" },
      description: "Issues and pull requests on github.com",
    },
    secrets: { "github-token": "demo-screenshot-fixture-token" },
  },
  {
    name: "docs",
    entry: {
      url: "https://docs.aurora.example/mcp",
      headers: { Authorization: "Bearer ${secret:docs-token}" },
      description: "Aurora engineering handbook and runbooks",
    },
    secrets: { "docs-token": "demo-screenshot-fixture-token" },
  },
] as const;

export const DEMO_MCP_TOOLS: Record<string, Tool[]> = {
  github: [
    {
      name: "list_pull_requests",
      description:
        "List pull requests of a repository, filtered by state and base branch.",
      inputSchema: object(
        {
          repo: text("Repository as owner/name."),
          state: { type: "string", enum: ["open", "closed", "merged"] },
          base: text("Base branch."),
        },
        ["repo"],
      ),
    },
    {
      name: "get_pull_request",
      description: "Get one pull request with its checks and review state.",
      inputSchema: object(
        { repo: text("Repository as owner/name."), number: { type: "number" } },
        ["repo", "number"],
      ),
    },
    {
      name: "search_issues",
      description: "Search issues and pull requests with GitHub search syntax.",
      inputSchema: object({ query: text("Search query.") }, ["query"]),
    },
    {
      name: "get_issue",
      description: "Get one issue with its labels and assignees.",
      inputSchema: object(
        { repo: text("Repository as owner/name."), number: { type: "number" } },
        ["repo", "number"],
      ),
    },
    {
      name: "create_issue",
      description: "Create an issue in a repository.",
      inputSchema: object(
        {
          repo: text("Repository as owner/name."),
          title: text("Issue title."),
          body: text("Issue body in Markdown."),
        },
        ["repo", "title"],
      ),
    },
    {
      name: "add_issue_comment",
      description: "Add a comment to an issue or pull request.",
      inputSchema: object(
        {
          repo: text("Repository as owner/name."),
          number: { type: "number" },
          body: text("Comment in Markdown."),
        },
        ["repo", "number", "body"],
      ),
    },
    {
      name: "list_commits",
      description: "List commits of a branch.",
      inputSchema: object(
        { repo: text("Repository as owner/name."), branch: text("Branch.") },
        ["repo"],
      ),
    },
  ],
  docs: [
    {
      name: "search_docs",
      description: "Search the engineering handbook and runbooks.",
      inputSchema: object({ query: text("Search query.") }, ["query"]),
    },
    {
      name: "get_page",
      description: "Read one handbook page as Markdown.",
      inputSchema: object({ path: text("Page path.") }, ["path"]),
    },
    {
      name: "list_runbooks",
      description: "List the on-call runbooks with their owners.",
      inputSchema: object({}),
    },
  ],
};
