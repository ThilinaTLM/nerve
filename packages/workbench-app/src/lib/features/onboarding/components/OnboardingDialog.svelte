<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import KeyRound from "@lucide/svelte/icons/key-round";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import {
  SettingsList,
  SettingsListItem,
} from "$lib/presentation/components/settings";

type Props = {
  providerReady: boolean;
  voiceReady: boolean;
  scopedModelsSummary: string;
  agentDefaultsReady: boolean;
  agentDefaultsSummary: string;
  productTourReady: boolean;
  readyCount: number;
  totalCount: number;
  onGuideProvider: () => void;
  onGuideVoice: () => void;
  onGuideScopedModels: () => void;
  onGuideAgentDefaults: () => void;
  onStartTour: () => void;
  onDoNotShowAgain: () => void;
  onNotNow: () => void;
};

let {
  providerReady,
  voiceReady,
  scopedModelsSummary,
  agentDefaultsReady,
  agentDefaultsSummary,
  productTourReady,
  readyCount,
  totalCount,
  onGuideProvider,
  onGuideVoice,
  onGuideScopedModels,
  onGuideAgentDefaults,
  onStartTour,
  onDoNotShowAgain,
  onNotNow,
}: Props = $props();
</script>

<Dialog
  open
  size="md"
  title="Set up Nerve"
  description="Connect the essentials and choose your agent defaults. You can pause and continue from the titlebar at any time."
  closeLabel="Not now"
  onOpenChange={(open) => {
    if (!open) onNotNow();
  }}
>
  <div
    class="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60"
  >
    <div
      class="grid gap-2 bg-muted/40 px-3 py-2"
      aria-label={`${readyCount} of ${totalCount} setup areas ready`}
    >
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>Setup overview</span>
        <span>{readyCount} of {totalCount} ready</span>
      </div>
      <Progress
        value={readyCount}
        max={totalCount}
        aria-label="Setup progress"
      />
    </div>

    <SettingsList ariaLabel="Setup checklist">
      <SettingsListItem
        class="px-3"
        title="Connect a model provider"
        description="Authenticate a subscription, API key, or compatible custom provider before prompting an agent."
      >
        {#snippet leading()}
          <KeyRound
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
        {#snippet meta()}
          <Badge tone={providerReady ? "good" : "neutral"} size="xs">
            {providerReady ? "Completed" : "Needs setup"}
          </Badge>
        {/snippet}
        {#snippet actions()}
          <Button variant="outline" size="xs" onclick={onGuideProvider}>
            View guide
          </Button>
        {/snippet}
      </SettingsListItem>

      <SettingsListItem
        class="px-3"
        title="Enable voice input"
        description="Audio-to-text requires a connected ChatGPT subscription through OpenAI Codex OAuth."
      >
        {#snippet leading()}
          <Mic
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
        {#snippet meta()}
          <Badge tone={voiceReady ? "good" : "neutral"} size="xs">
            {voiceReady ? "Completed" : "Optional"}
          </Badge>
        {/snippet}
        {#snippet actions()}
          <Button variant="outline" size="xs" onclick={onGuideVoice}>
            View guide
          </Button>
        {/snippet}
      </SettingsListItem>

      <SettingsListItem
        class="px-3"
        title="Configure scoped models"
        description={`${scopedModelsSummary}. Add a scope to limit the models offered by the composer.`}
      >
        {#snippet leading()}
          <SlidersHorizontal
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
        {#snippet meta()}
          <Badge tone="good" size="xs">Completed</Badge>
        {/snippet}
        {#snippet actions()}
          <Button variant="outline" size="xs" onclick={onGuideScopedModels}>
            View guide
          </Button>
        {/snippet}
      </SettingsListItem>

      <SettingsListItem
        class="px-3"
        title="Configure agent defaults"
        description={agentDefaultsSummary}
      >
        {#snippet leading()}
          <Bot
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
        {#snippet meta()}
          <Badge tone={agentDefaultsReady ? "good" : "neutral"} size="xs">
            {agentDefaultsReady ? "Completed" : "Using fallbacks"}
          </Badge>
        {/snippet}
        {#snippet actions()}
          <Button variant="outline" size="xs" onclick={onGuideAgentDefaults}>
            View guide
          </Button>
        {/snippet}
      </SettingsListItem>

      <SettingsListItem
        class="px-3"
        title="Discover the Workbench"
        description="Learn conversations, composer controls, panels, Git workflows, tasks, providers, settings, and Help."
      >
        {#snippet leading()}
          <PanelsTopLeft
            class="size-4 flex-none text-info"
            aria-hidden="true"
          />
        {/snippet}
        {#snippet meta()}
          <Badge tone={productTourReady ? "good" : "neutral"} size="xs">
            {productTourReady ? "Completed" : "Recommended"}
          </Badge>
        {/snippet}
        {#snippet actions()}
          <Button variant="default" size="xs" onclick={onStartTour}>
            {productTourReady ? "Replay product tour" : "Start product tour"}
          </Button>
        {/snippet}
      </SettingsListItem>
    </SettingsList>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onNotNow}>Not now</Button>
      <Button variant="outline" size="sm" onclick={onDoNotShowAgain}
        >Do not show again</Button
      >
    </div>
  {/snippet}
</Dialog>
