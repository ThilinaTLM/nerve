/* The project setup the homepage follows: one Forge conversation that fits
 * Nerve to the `aurora` project, then the same items in the stack and in the
 * workbench. "Make it yours" plays the conversation, "Plugged into your
 * stack" lights what it added, "Everything around the chat" shows each item
 * in place.
 *
 * Facts follow the docs (guides/configure-by-chat, build-extensions,
 * skills-and-resources, prompt-suggestions, mcp, background-tasks):
 * - Forge writes the files, then runs `configuration.check` and
 *   `configuration.reload`.
 * - A project skill, a project MCP entry and a new extension wait for the
 *   user's review in Settings; the agent can't approve them. A launch and a
 *   prompt suggestion without a script take effect at once.
 * - An extension waits as Pending consent with a plain-language list of what
 *   it asks for.
 */

import type { BrandIconName } from "../../components/marketing/brand-icons";

export type ForgeSetupKind =
  | "skill"
  | "suggestion"
  | "launch"
  | "mcp"
  | "extension";

export type ForgeSetupStep = { tool: string; detail: string };

export type ForgeSetupItem = {
  id: string;
  kind: ForgeSetupKind;
  /* The kind as the UI names it. */
  kindLabel: string;
  /* What the user sees once it is set up. */
  name: string;
  brand?: BrandIconName;
  steps: readonly ForgeSetupStep[];
  /* Where it waits for the user, or undefined when it applies at once. */
  review?: string;
};

export const forgeSetupProject = "aurora";

export const forgeSetupAsk =
  "Set Nerve up for aurora. We track work in Linear, watch errors in Sentry, run pnpm dev, and follow our API conventions.";

export const forgeSetupItems: readonly ForgeSetupItem[] = [
  {
    id: "api-conventions",
    kind: "skill",
    kindLabel: "Skill",
    name: "API conventions",
    steps: [
      { tool: "write", detail: ".nerve/skills/api-conventions/SKILL.md" },
    ],
    review: "Settings → Skills",
  },
  {
    id: "linear",
    kind: "mcp",
    kindLabel: "MCP server",
    name: "Linear",
    brand: "linear",
    steps: [{ tool: "write", detail: ".nerve/config/mcp.json" }],
    review: "Settings → MCP servers",
  },
  {
    id: "sentry-errors",
    kind: "extension",
    kindLabel: "Extension",
    name: "Sentry errors",
    brand: "sentry",
    steps: [
      { tool: "bash", detail: "npx nerve-ext init sentry-errors --kind panel" },
      { tool: "write", detail: "src/panels/Errors.svelte" },
      { tool: "bash", detail: "npm run build" },
      { tool: "quick_script", detail: "extensions.reload sentry-errors" },
    ],
    review: "Settings → Extensions",
  },
  {
    id: "web-dev",
    kind: "launch",
    kindLabel: "Launch",
    name: "Web dev · pnpm dev",
    steps: [
      {
        tool: "quick_script",
        detail: 'launches.create({ label: "Web dev", command: "pnpm dev" })',
      },
    ],
  },
  {
    id: "triage-sentry",
    kind: "suggestion",
    kindLabel: "Prompt suggestion",
    name: "Triage new Sentry errors",
    steps: [{ tool: "write", detail: ".nerve/suggestions/triage-sentry.md" }],
  },
];

/* Run after the files are written. */
export const forgeSetupChecks: readonly ForgeSetupStep[] = [
  { tool: "quick_script", detail: 'configuration.check("project")' },
  { tool: "quick_script", detail: 'configuration.reload("project")' },
];

/* What the Sentry extension asks for at consent. */
export const forgeSetupConsent = [
  "Connects to sentry.io",
  "Uses your Sentry account",
] as const;

export const forgeSetupReviewCount = forgeSetupItems.filter(
  (item) => item.review,
).length;
