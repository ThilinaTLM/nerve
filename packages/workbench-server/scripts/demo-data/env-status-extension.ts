/**
 * Sources of the demo project extension `env-status`: a dock panel with fixed QA and Production
 * status. The seed writes them into Aurora's `.nerve/extensions/` and builds them with the SDK;
 * the Forge demo conversation shows the same text being written. Nothing here touches the network.
 */

export const ENV_STATUS_EXTENSION = `import { defineExtension } from "@nervekit/extension-sdk";

export default defineExtension({
  id: "env-status",
  name: "Environment status",
  description:
    "A side panel showing whether the QA and Production environments are up.",
  icon: "globe",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
  ui: {
    panels: [
      {
        id: "environments",
        label: "Environments",
        icon: "globe",
        entry: "src/panels/environments/Environments.svelte",
      },
    ],
  },
});
`;

export const ENV_STATUS_DATA = `export type Health = "healthy" | "degraded";

export type Environment = {
  id: string;
  name: string;
  url: string;
  health: Health;
  version: string;
  deployedAt: string;
  note: string;
};

/** Fixed sample data: this panel never touches the network. */
export const environments: Environment[] = [
  {
    id: "qa",
    name: "QA",
    url: "qa.aurora.example",
    health: "degraded",
    version: "v2.4.0-rc.3",
    deployedAt: "25 minutes ago",
    note: "1 of 6 smoke checks slow",
  },
  {
    id: "production",
    name: "Production",
    url: "app.aurora.example",
    health: "healthy",
    version: "v2.3.4",
    deployedAt: "3 days ago",
    note: "All 6 smoke checks passing",
  },
];

export const recentDeploys = [
  { id: "d1", label: "v2.4.0-rc.3 to QA", when: "25 minutes ago" },
  { id: "d2", label: "v2.4.0-rc.2 to QA", when: "yesterday" },
  { id: "d3", label: "v2.3.4 to Production", when: "3 days ago" },
  { id: "d4", label: "v2.3.3 to Production", when: "9 days ago" },
];

export function summary(items: readonly Environment[]): string {
  const down = items.filter((item) => item.health !== "healthy").length;
  return down === 0
    ? "All environments healthy"
    : \`\${down} of \${items.length} need attention\`;
}
`;

export const ENV_STATUS_PANEL = `<script lang="ts">
import { Activity, Clock, RefreshCw, Tag } from "@nervekit/extension-sdk/ui";
import {
  Badge,
  PanelHeader,
  PanelList,
  PanelRow,
  PanelRowCard,
  PanelSectionHeader,
  PanelToolbarButton,
  PanelView,
  ScrollArea,
  StatusDot,
} from "@nervekit/extension-sdk/ui";
import { environments, recentDeploys, summary } from "./environments";

let checkedAt = $state("just now");

function refresh() {
  checkedAt = "just now";
}
</script>

<PanelView>
  {#snippet banner()}
    <PanelHeader title="Environments" count={environments.length}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={RefreshCw}
          label="Refresh status"
          onclick={refresh}
        />
      {/snippet}
    </PanelHeader>
    <p class="pb-1.5 text-ui text-muted-foreground">
      {summary(environments)} · checked {checkedAt}
    </p>
  {/snippet}

  <ScrollArea class="min-h-0 flex-1">
    <PanelList ariaLabel="Environments">
      {#each environments as env (env.id)}
        {@const healthy = env.health === "healthy"}
        <PanelRowCard role="listitem">
          <PanelRow label={env.name} description={env.url} hoverable={false}>
            {#snippet leading()}
              <StatusDot
                tone={healthy ? "success" : "warning"}
                label={env.health}
              />
            {/snippet}
            {#snippet badges()}
              <Badge variant={healthy ? "success" : "warning"}>
                {healthy ? "Healthy" : "Degraded"}
              </Badge>
            {/snippet}
          </PanelRow>
          <PanelRow label={env.version} hoverable={false} dense>
            {#snippet leading()}<Tag class="size-3.5 text-muted-foreground" />{/snippet}
          </PanelRow>
          <PanelRow
            label={"Deployed " + env.deployedAt}
            hoverable={false}
            dense
          >
            {#snippet leading()}<Clock class="size-3.5 text-muted-foreground" />{/snippet}
          </PanelRow>
          <PanelRow
            label={env.note}
            tone={healthy ? "neutral" : "warning"}
            hoverable={false}
            dense
          >
            {#snippet leading()}<Activity class="size-3.5 text-muted-foreground" />{/snippet}
          </PanelRow>
        </PanelRowCard>
      {/each}
    </PanelList>
    <PanelSectionHeader title="Recent deploys" />
    <PanelList ariaLabel="Recent deploys">
      {#each recentDeploys as deploy (deploy.id)}
        <PanelRow label={deploy.label} description={deploy.when} dense />
      {/each}
    </PanelList>
  </ScrollArea>
</PanelView>
`;

export const ENV_STATUS_TEST = `import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import { environments, recentDeploys, summary } from "./environments";

describe("environments", () => {
  it("summarises how many environments need attention", () => {
    expect(summary(environments)).toBe("1 of 2 need attention");
    expect(summary(environments.filter((item) => item.id === "production"))).toBe(
      "All environments healthy",
    );
  });
});
`;

/**
 * `extension.ts` of the second demo extension, `status-page`. The seed scaffolds it with
 * `nerve-ext init --kind integration` and replaces this file; it is left unreviewed, so
 * Settings → Extensions shows its consent review.
 */
export const STATUS_PAGE_EXTENSION = `import { defineExtension } from "@nervekit/extension-sdk";
import { namespace } from "./backend/namespace";

export default defineExtension({
  id: "status-page",
  name: "Status page",
  description:
    "Reads incidents and component status from the team's public status page.",
  icon: "globe",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      server: {
        type: "string",
        label: "Status page",
        description: "Base URL of the status page; requests are sent to it.",
        format: "url",
        default: "https://status.aurora.example",
      },
    },
  },
  permissions: { network: ["https://status.aurora.example"] },
  namespaces: [namespace],
  tools: [
    {
      name: "status_page_get",
      description: "Read JSON from the configured status page.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path starting with '/'." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      method: "statusPage.get",
    },
  ],
});
`;
