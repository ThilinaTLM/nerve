<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Layers from "@lucide/svelte/icons/layers";
import {
  PanelPropertyRow,
  PanelSectionHeader,
  PanelToolbarButton,
} from "@nervekit/workbench-ui/panel";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";

let {
  status,
  activeProject,
  activeConversation,
  activeAgent,
}: {
  status?: StatusResponse;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
} = $props();

const PERMISSION_LABELS: Record<string, string> = {
  read_only: "Read only",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

function titleCase(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortAgentId(id: string): string {
  const parts = id.split("_");
  return parts.length > 1 ? (parts.at(-1) ?? id) : id.slice(-6);
}

type Field = { label: string; value?: string; mono?: boolean };

const fields = $derived.by<Field[]>(() => {
  const agentModel = activeAgent?.model;
  const thinkingLevel = activeAgent?.thinkingLevel;
  const entries: Field[] = [
    { label: "Project", value: activeProject?.name },
    { label: "Directory", value: activeProject?.dir, mono: true },
    { label: "Conversation", value: activeConversation?.title },
    {
      label: "Agent",
      value: activeAgent ? shortAgentId(activeAgent.id) : undefined,
      mono: true,
    },
    {
      label: "Model",
      value: agentModel
        ? `${agentModel.provider}/${agentModel.modelId}`
        : undefined,
      mono: true,
    },
    {
      label: "Mode",
      value: activeAgent ? titleCase(activeAgent.mode) : undefined,
    },
    {
      label: "Permission",
      value: activeAgent
        ? (PERMISSION_LABELS[activeAgent.permissionLevel] ??
          titleCase(activeAgent.permissionLevel))
        : undefined,
    },
    {
      label: "Thinking",
      value:
        thinkingLevel && thinkingLevel !== "off"
          ? titleCase(thinkingLevel)
          : undefined,
      // Hidden entirely when thinking is off; see filter below.
    },
    { label: "Daemon", value: status?.daemonId, mono: true },
    { label: "Data", value: status?.dataDir, mono: true },
  ];
  return entries.filter(
    (entry) => entry.label !== "Thinking" || entry.value !== undefined,
  );
});

const contextText = $derived(
  fields.map((field) => `${field.label}: ${field.value ?? "—"}`).join("\n"),
);

async function copyContext(): Promise<void> {
  try {
    await writeClipboardText(contextText);
    notify.success("Copied active context");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<section class="flex min-w-0 flex-col">
  <PanelSectionHeader title="Active context" icon={Layers}>
    {#snippet actions()}
      <PanelToolbarButton
        icon={Copy}
        label="Copy active context"
        onclick={() => void copyContext()}
      />
    {/snippet}
  </PanelSectionHeader>

  <div class="flex min-w-0 flex-col pb-1">
    {#each fields as field (field.label)}
      <PanelPropertyRow
        label={field.label}
        value={field.value}
        title={field.value}
        mono={field.mono ?? false}
      />
    {/each}
  </div>
</section>
