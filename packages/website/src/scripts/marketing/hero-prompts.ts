/* The hero's example runs: a prompt typed into the art's composer, the lead
 * profile that takes it, the run the art plays once it is sent, and the
 * chapter caption naming what the run shows.
 *
 * Tool names, SDK calls and notification titles are the app's own (`bash`,
 * `edit`, `quick_script` with `jira.issues.search`,
 * `confluence.pages.search`, `mcp.tools.call`, `launches.restart` and
 * `extensions.reload`, `subagent_prompt`, `plan_present`; push titles from
 * `push-notification-text.ts`). Paths and numbers belong to the demo
 * workspace, aurora.
 */

export type HeroProfile = "forge" | "coding" | "planning" | "lead";

/* A sub-agent as the composer's Agents tray lists it: its name and profile
 * (the built-in profiles are `developer` and `explore`). */
export type HeroAgent = { name: string; profile: "developer" | "explore" };

/* One step of a run: a tool call in the transcript, sub-agents starting in
 * the Agents tray (they finish one by one), or a card asking for the user
 * inline in the transcript (a plan to review). */
export type HeroStep =
  | { tool: string; detail: string }
  | { agents: readonly HeroAgent[] }
  | { ask: string; action: string };

/* The part of the art the camera visits when the run ends. */
export type HeroEffect =
  | "dock"
  | "pr"
  | "agents"
  | "jira"
  | "mcp"
  | "launches"
  | "phone";

export type HeroPrompt = {
  profile: HeroProfile;
  label: string;
  text: string;
  /* Conversation title, as a push notification shows it. */
  title: string;
  steps: readonly HeroStep[];
  reply: string;
  effect: HeroEffect;
  /* Push notification title when the run ends. */
  push: string;
  /* The chapter caption under the art while this run plays: what it shows,
   * in a few words. */
  chapter: string;
  caption: string;
};

export const heroPrompts: readonly HeroPrompt[] = [
  {
    profile: "forge",
    label: "Forge",
    text: "Add a dock panel that shows deploy status for QA and production",
    title: "Add an Environments panel",
    steps: [
      { tool: "read", detail: "deploy/environments.yaml" },
      { tool: "write", detail: ".nerve/extensions/env-status/src/panel.ts" },
      { tool: "bash", detail: "npx nerve-ext check" },
      { tool: "quick_script", detail: "extensions.reload env-status" },
    ],
    reply: "Environments panel is docked. QA is degraded.",
    effect: "dock",
    push: "Agent finished",
    chapter: "Forge",
    caption: "Forge builds the tools your work needs",
  },
  {
    profile: "coding",
    label: "Coding",
    text: "Booking tests fail about once in ten CI runs. Find the cause, fix it and open a PR",
    title: "Fix the flaky booking tests",
    steps: [
      { tool: "bash", detail: "pnpm test bookings --repeat 20" },
      { tool: "grep", detail: "Date.now src/bookings" },
      { tool: "edit", detail: "src/bookings/clock.ts" },
      { tool: "bash", detail: "pnpm test bookings --repeat 50" },
      { tool: "bash", detail: "gh pr create --fill" },
    ],
    reply: "A shared clock raced between tests. Fixed, PR is open.",
    effect: "pr",
    push: "Agent finished",
    chapter: "Coding",
    caption: "Agents test, fix and open the pull request",
  },
  {
    profile: "lead",
    label: "Lead",
    text: "Migrate every API route from Express to Fastify. Split it across sub-agents and verify each route",
    title: "Migrate the API to Fastify",
    steps: [
      { tool: "subagent_prompt", detail: "4 developers, one per route group" },
      {
        agents: [
          { name: "bookings", profile: "developer" },
          { name: "venues", profile: "developer" },
          { name: "users", profile: "developer" },
          { name: "payments", profile: "developer" },
        ],
      },
      { tool: "subagent_prompt", detail: "explore: verify every route" },
      { agents: [{ name: "verify-routes", profile: "explore" }] },
      { tool: "bash", detail: "pnpm test:contract" },
    ],
    reply: "All 42 routes run on Fastify. Contract tests pass.",
    effect: "agents",
    push: "Agent finished",
    chapter: "Lead",
    caption: "Big jobs split across sub-agents",
  },
  {
    profile: "coding",
    label: "Coding",
    text: "Pick up the Jira issue about slow venue search, fix it and comment on the ticket",
    title: "Speed up venue search",
    steps: [
      { tool: "quick_script", detail: 'jira.issues.search "venue search"' },
      { tool: "read", detail: "src/venues/search.ts" },
      { tool: "edit", detail: "src/venues/search.ts" },
      { tool: "bash", detail: "pnpm test venues" },
      { tool: "quick_script", detail: "jira.comments.add" },
    ],
    reply: "Search uses the city index now. Commented on the issue.",
    effect: "jira",
    push: "Agent finished",
    chapter: "Jira",
    caption: "Jira and Confluence, built in",
  },
  {
    profile: "coding",
    label: "Coding",
    text: "Use the docs MCP server to check how webhook retries work, then fix our handler to match",
    title: "Match webhook retry rules",
    steps: [
      {
        tool: "quick_script",
        detail: 'mcp.tools.call docs/search "webhook retries"',
      },
      { tool: "read", detail: "src/webhooks/handler.ts" },
      { tool: "edit", detail: "src/webhooks/handler.ts" },
      { tool: "bash", detail: "pnpm test webhooks" },
    ],
    reply: "Retries now back off as the docs require. Tests pass.",
    effect: "mcp",
    push: "Agent finished",
    chapter: "MCP",
    caption: "Any MCP server, approved tool by tool",
  },
  {
    profile: "coding",
    label: "Coding",
    text: "The dev server crashes on start. Find out why and get it running again",
    title: "Fix the dev server crash",
    steps: [
      { tool: "quick_script", detail: 'launches.logs "dev server"' },
      { tool: "grep", detail: "DATABASE_URL src/config" },
      { tool: "edit", detail: "src/config/env.ts" },
      { tool: "quick_script", detail: 'launches.restart "dev server"' },
    ],
    reply: "A renamed env variable broke startup. It runs again.",
    effect: "launches",
    push: "Agent finished",
    chapter: "Launches",
    caption: "Agents run, read and restart your launches",
  },
  {
    profile: "planning",
    label: "Planning",
    text: "Plan per-tenant rate limits for the booking API without breaking existing clients",
    title: "Plan per-tenant rate limits",
    steps: [
      { tool: "grep", detail: "rateLimit src/" },
      { tool: "read", detail: "src/middleware/limiter.ts" },
      { tool: "read", detail: "docs/api/clients.md" },
      { tool: "plan_present", detail: "3 phases, behind a flag" },
      { ask: "Plan ready for review", action: "Review plan" },
    ],
    reply: "The plan is ready. Review it before anything changes.",
    effect: "phone",
    push: "Plan ready for review",
    chapter: "Remote",
    caption: "Plans reach your phone over Tailscale",
  },
];
