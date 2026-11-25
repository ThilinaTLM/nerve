/* The Forge demo's builds: a request from the "Just ask" marquee, the steps
 * Forge takes, what the extension asks for at consent, and what it shows
 * once allowed.
 *
 * The flow follows the docs (guides/build-extensions): Forge creates the
 * project with `nerve-ext init`, writes and builds it, and reloads it; the
 * extension then waits as Pending consent with a plain-language list of what
 * it asks for (websites, accounts, tools), and only the user can choose
 * Allow. Environments mirrors the demo workspace's `env-status`, which
 * declares no websites, accounts or tools.
 */

import type { BrandIconName } from "../../components/marketing/brand-icons";

export type ForgeDemoRow = {
  tone: "success" | "warning" | "danger" | "muted";
  label: string;
  meta: string;
};

export type ForgeDemoBuild = {
  id: string;
  ask: string;
  /* Where the result appears: a dock panel or a page tab. */
  kind: "panel" | "page";
  name: string;
  brand?: BrandIconName;
  source: string;
  asks: readonly string[];
  rows: readonly ForgeDemoRow[];
};

export const forgeDemoBuilds: readonly ForgeDemoBuild[] = [
  {
    id: "env-status",
    ask: "Show QA and prod health in a side panel",
    kind: "panel",
    name: "Environments",
    source: "src/panels/Environments.svelte",
    asks: ["No websites, accounts or tools"],
    rows: [
      { tone: "warning", label: "QA", meta: "Degraded" },
      { tone: "success", label: "Production", meta: "Healthy" },
    ],
  },
  {
    id: "linear-issues",
    ask: "A tab with my open Linear issues",
    kind: "page",
    name: "Linear issues",
    brand: "linear",
    source: "src/pages/Issues.svelte",
    asks: ["Connects to api.linear.app", "Uses your Linear account"],
    rows: [
      {
        tone: "warning",
        label: "Rate limit the booking API",
        meta: "In progress",
      },
      { tone: "muted", label: "Venue photos on the new CDN", meta: "Todo" },
      { tone: "muted", label: "Flaky booking clock test", meta: "Todo" },
    ],
  },
  {
    id: "sentry-errors",
    ask: "Put new Sentry errors next to the chat",
    kind: "panel",
    name: "Sentry errors",
    brand: "sentry",
    source: "src/panels/Errors.svelte",
    asks: ["Connects to sentry.io", "Uses your Sentry account"],
    rows: [
      { tone: "danger", label: "TypeError in booking.ts", meta: "42 events" },
      { tone: "warning", label: "Timeout on /venues", meta: "9 events" },
    ],
  },
];

/* The tool calls a build shows, from its id and source file. */
export function forgeDemoSteps(build: ForgeDemoBuild) {
  return [
    { tool: "bash", detail: `npx nerve-ext init ${build.id}` },
    { tool: "write", detail: build.source },
    { tool: "bash", detail: "npm run build" },
    { tool: "quick_script", detail: `extensions.reload ${build.id}` },
  ];
}
