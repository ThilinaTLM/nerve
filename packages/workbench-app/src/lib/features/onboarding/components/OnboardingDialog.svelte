<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import CheckCircle2 from "@lucide/svelte/icons/circle-check";
import Circle from "@lucide/svelte/icons/circle";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import OnboardingSetupItem from "./OnboardingSetupItem.svelte";

type Props = {
  providerReady: boolean;
  voiceReady: boolean;
  scopedModelsSummary: string;
  agentDefaultsReady: boolean;
  agentDefaultsSummary: string;
  onOpenProviders: () => void;
  onOpenScopedModels: () => void;
  onOpenAgentSettings: () => void;
  onStartTour: () => void;
  onComplete: () => void;
  onNotNow: () => void;
};

let {
  providerReady,
  voiceReady,
  scopedModelsSummary,
  agentDefaultsReady,
  agentDefaultsSummary,
  onOpenProviders,
  onOpenScopedModels,
  onOpenAgentSettings,
  onStartTour,
  onComplete,
  onNotNow,
}: Props = $props();

const readyCount = $derived(
  Number(providerReady) + Number(voiceReady) + 1 + Number(agentDefaultsReady),
);
</script>

<Dialog
  open
  size="wide"
  title="Set up Nerve"
  description="Connect the essentials and choose your agent defaults. You can return here from Help at any time."
  closeLabel="Not now"
  onOpenChange={(open) => {
    if (!open) onNotNow();
  }}
>
  <div class="grid gap-4">
    <div class="grid gap-2" aria-label={`${readyCount} of 4 setup areas ready`}>
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>Setup overview</span>
        <span>{readyCount} of 4 ready</span>
      </div>
      <Progress value={readyCount} max={4} aria-label="Setup progress" />
    </div>

    <div class="grid gap-2">
      <OnboardingSetupItem
        icon={providerReady ? CheckCircle2 : Circle}
        iconClass={providerReady ? "text-success" : "text-muted-foreground"}
        title="Connect a model provider"
        status={providerReady ? "Connected" : "Needs setup"}
        statusTone={providerReady ? "good" : "neutral"}
        description="Authenticate a subscription or API provider before prompting an agent."
        actionLabel="Open providers"
        onAction={onOpenProviders}
      />
      <OnboardingSetupItem
        icon={Mic}
        iconClass={voiceReady ? "text-success" : "text-muted-foreground"}
        title="Enable voice input"
        status={voiceReady ? "Ready" : "Optional"}
        statusTone={voiceReady ? "good" : "neutral"}
        description="Audio-to-text requires a connected ChatGPT subscription through OpenAI Codex OAuth."
        actionLabel="Open providers"
        onAction={onOpenProviders}
      />
      <OnboardingSetupItem
        icon={ShieldCheck}
        iconClass="text-info"
        title="Configure scoped models"
        status="Ready"
        statusTone="good"
        description={`${scopedModelsSummary}. Add a scope to limit the models offered by the composer.`}
        actionLabel="Open settings"
        onAction={onOpenScopedModels}
      />
      <OnboardingSetupItem
        icon={Bot}
        iconClass={agentDefaultsReady ? "text-success" : "text-info"}
        title="Configure agent defaults"
        status={agentDefaultsReady ? "Configured" : "Using fallbacks"}
        statusTone={agentDefaultsReady ? "good" : "neutral"}
        description={agentDefaultsSummary}
        actionLabel="Open agent settings"
        onAction={onOpenAgentSettings}
      />
    </div>

    <div class="rounded-lg border border-info/30 bg-info/10 p-3">
      <div class="flex gap-3">
        <PanelsTopLeft
          class="mt-0.5 size-5 flex-none text-info"
          aria-hidden="true"
        />
        <div class="grid gap-1">
          <h3 class="text-sm font-medium text-foreground">
            Discover the workbench
          </h3>
          <p class="text-xs leading-relaxed text-muted-foreground">
            The tour helps you open a project when needed, create a
            conversation, and learn the live composer, panels, Git workflows,
            skills, tasks, and usage.
          </p>
        </div>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onNotNow}>Not now</Button>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onclick={onComplete}
          >Mark complete</Button
        >
        <Button size="sm" onclick={onStartTour}>Start product tour</Button>
      </div>
    </div>
  {/snippet}
</Dialog>
