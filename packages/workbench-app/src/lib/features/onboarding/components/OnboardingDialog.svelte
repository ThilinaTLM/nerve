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
  size="wide"
  title="Set up Nerve"
  description="Connect the essentials and choose your agent defaults. You can pause and continue from the titlebar at any time."
  closeLabel="Not now"
  onOpenChange={(open) => {
    if (!open) onNotNow();
  }}
>
  <div class="grid gap-4">
    <div
      class="grid gap-2"
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

    <div class="grid gap-2">
      <OnboardingSetupItem
        icon={providerReady ? CheckCircle2 : Circle}
        iconClass={providerReady ? "text-success" : "text-muted-foreground"}
        title="Connect a model provider"
        status={providerReady ? "Connected" : "Needs setup"}
        statusTone={providerReady ? "good" : "neutral"}
        description="Authenticate a subscription, API key, or compatible custom provider before prompting an agent."
        actionLabel={providerReady ? "Review guide" : "Start guide"}
        onAction={onGuideProvider}
      />
      <OnboardingSetupItem
        icon={Mic}
        iconClass={voiceReady ? "text-success" : "text-muted-foreground"}
        title="Enable voice input"
        status={voiceReady ? "Ready" : "Optional"}
        statusTone={voiceReady ? "good" : "neutral"}
        description="Audio-to-text requires a connected ChatGPT subscription through OpenAI Codex OAuth."
        actionLabel={voiceReady ? "Review guide" : "Start guide"}
        onAction={onGuideVoice}
      />
      <OnboardingSetupItem
        icon={ShieldCheck}
        iconClass="text-info"
        title="Configure scoped models"
        status="Ready"
        statusTone="good"
        description={`${scopedModelsSummary}. Add a scope to limit the models offered by the composer.`}
        actionLabel="Start guide"
        onAction={onGuideScopedModels}
      />
      <OnboardingSetupItem
        icon={Bot}
        iconClass={agentDefaultsReady ? "text-success" : "text-info"}
        title="Configure agent defaults"
        status={agentDefaultsReady ? "Configured" : "Using fallbacks"}
        statusTone={agentDefaultsReady ? "good" : "neutral"}
        description={agentDefaultsSummary}
        actionLabel={agentDefaultsReady ? "Review guide" : "Start guide"}
        onAction={onGuideAgentDefaults}
      />
      <OnboardingSetupItem
        icon={productTourReady ? CheckCircle2 : PanelsTopLeft}
        iconClass={productTourReady ? "text-success" : "text-info"}
        title="Discover the Workbench"
        status={productTourReady ? "Completed" : "Recommended"}
        statusTone={productTourReady ? "good" : "neutral"}
        description="Learn conversations, composer controls, panels, Git workflows, tasks, providers, settings, and Help."
        actionLabel={productTourReady
          ? "Replay product tour"
          : "Start product tour"}
        actionVariant="primary"
        onAction={onStartTour}
      />
    </div>
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
