<!--
  The configuration fields of one tool, edited as its canonical payload. Used
  by the Configure dialog on the Tools page and by profile changes, so a
  template configures a tool exactly as settings do.
-->
<script lang="ts">
import { canonicalSettingRequired } from "$lib/presentation/composer/capability-tool-locks";
import type { ModelInfo } from "$lib/api";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { type ToolId, type ToolPayload } from "./tool-settings";

type Props = {
  name: ToolId;
  requiredPointers?: readonly string[];
  payload: ToolPayload;
  /** Whether the draft can be saved. */
  valid?: boolean;
  /** Authenticated models; the vision picker narrows them itself. */
  models?: ModelInfo[];
  /** Main-agent profiles offered as the plan-approval target. */
  leadProfiles?: { name: string; label: string }[];
  /** The Python executable currently in use, shown under the path field. */
  resolvedPython?: string;
};

let {
  name,
  requiredPointers = [],
  payload = $bindable(),
  valid = $bindable(true),
  models = [],
  leadProfiles = [],
  resolvedPython,
}: Props = $props();

function required(field: string): boolean {
  return canonicalSettingRequired(`/tools/${name}/${field}`, requiredPointers);
}

type Loose = Record<string, unknown>;
const settings = $derived((payload.settings ?? {}) as Loose);
const auto = $derived(
  (settings.autoPromotion ?? { enabled: true, afterMs: 120_000 }) as {
    enabled: boolean;
    afterMs: number;
  },
);

function patchSettings(next: Loose): void {
  payload = { ...payload, settings: { ...settings, ...next } };
}
function removeSetting(key: string): void {
  const next = { ...settings };
  delete next[key];
  payload = { ...payload, settings: next };
}

// Bash: seconds in the UI, milliseconds stored.
const afterSeconds = $derived(String(Number(auto.afterMs) / 1000));
const timeoutSeconds = $derived(
  String(Number(settings.maxTimeoutMs ?? 900_000) / 1000),
);
const validAfter = $derived(
  Number.isInteger(Number(afterSeconds)) &&
    Number(afterSeconds) >= 1 &&
    Number(afterSeconds) <= 86_400,
);
const validTimeout = $derived(
  Number.isInteger(Number(timeoutSeconds)) &&
    Number(timeoutSeconds) >= 1 &&
    Number(timeoutSeconds) <= 3600,
);

$effect(() => {
  const nextValid =
    name === "bash"
      ? validAfter && (auto.enabled || validTimeout)
      : name === "plan_present"
        ? Boolean(settings.approvalProfile)
        : name === "explain_image"
          ? Boolean(settings.model)
          : true;
  if (valid !== nextValid) valid = nextValid;
});
</script>

<div class="grid gap-4">
  {#if name === "bash"}
    <div class="flex items-center justify-between gap-4">
      <div class="grid gap-1">
        <Label for="tool-bash-auto">Automatic backgrounding</Label>
        <p class="text-ui text-muted-foreground">
          Promote calls still running after the delay to a background run.
        </p>
      </div>
      <Switch
        disabled={required("settings/autoPromotion")}
        id="tool-bash-auto"
        checked={auto.enabled}
        aria-label="Enable automatic backgrounding"
        onCheckedChange={(enabled) =>
          patchSettings({ autoPromotion: { ...auto, enabled } })}
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="tool-bash-after">Background after</Label>
      <div class="flex items-center gap-2">
        <Input
          id="tool-bash-after"
          type="number"
          min={1}
          max={86_400}
          value={afterSeconds}
          disabled={!auto.enabled || required("settings/autoPromotion")}
          aria-label="Background after seconds"
          oninput={(event) =>
            patchSettings({
              autoPromotion: {
                ...auto,
                afterMs: Number(event.currentTarget.value) * 1000,
              },
            })}
        />
        <span class="text-ui text-muted-foreground">seconds</span>
      </div>
      {#if auto.enabled && !validAfter}
        <p class="text-ui text-destructive">
          Enter a whole number from 1 to 86,400.
        </p>
      {/if}
    </div>
    {#if !auto.enabled}
      <div class="grid gap-1.5">
        <Label for="tool-bash-timeout">Maximum timeout</Label>
        <p class="text-ui text-muted-foreground">
          Agent calls must set a timeout up to this limit; your own commands use
          it as their timeout.
        </p>
        <div class="flex items-center gap-2">
          <Input
            disabled={required("settings/maxTimeoutMs")}
            id="tool-bash-timeout"
            type="number"
            min={1}
            max={3600}
            value={timeoutSeconds}
            aria-label="Maximum timeout seconds"
            oninput={(event) =>
              patchSettings({
                maxTimeoutMs: Number(event.currentTarget.value) * 1000,
              })}
          />
          <span class="text-ui text-muted-foreground">seconds</span>
        </div>
        {#if !validTimeout}
          <p class="text-ui text-destructive">
            Enter a whole number from 1 to 3,600.
          </p>
        {/if}
      </div>
    {/if}
    <div class="grid gap-1.5">
      <Label for="tool-bash-shell">Shell</Label>
      <Input
        disabled={required("settings/shellPath")}
        id="tool-bash-shell"
        class="font-mono"
        value={String(settings.shellPath ?? "")}
        placeholder="Default shell"
        aria-label="Shell path"
        oninput={(event) => {
          const next = event.currentTarget.value.trim();
          if (next) patchSettings({ shellPath: next });
          else removeSetting("shellPath");
        }}
      />
    </div>
  {:else if name === "python_exec"}
    <div class="grid gap-1.5">
      <Label for="tool-python-path">Python executable</Label>
      <Input
        disabled={required("settings/interpreterPath")}
        id="tool-python-path"
        class="font-mono"
        value={String(settings.interpreterPath ?? "")}
        placeholder="Auto-detect"
        aria-label="Python executable path"
        oninput={(event) => {
          const next = event.currentTarget.value.trim();
          if (next) patchSettings({ interpreterPath: next });
          else removeSetting("interpreterPath");
        }}
      />
      <p class="text-ui text-muted-foreground">
        Leave empty to auto-detect from the project and system PATH.
        {#if resolvedPython}
          In use: <span class="font-mono">{resolvedPython}</span>
        {/if}
      </p>
    </div>
  {:else if name === "explain_image"}
    <div class="grid gap-1.5">
      <Label>Vision model</Label>
      <ModelPicker
        modelDisabled={required("settings/model")}
        thinkingDisabled={required("settings/thinkingLevel")}
        lockReason="Required by the active profile"
        label="Image explanation model"
        class="w-full"
        {models}
        requiredCapabilities={["vision"]}
        value={settings.model as never}
        thinkingLevel={settings.thinkingLevel as never}
        emptyMessage="Connect a provider with a vision-capable model first."
        onChange={(next) =>
          patchSettings({
            ...(!required("settings/model") ? { model: next.model } : {}),
            ...(!required("settings/thinkingLevel")
              ? { thinkingLevel: next.thinkingLevel }
              : {}),
          })}
      />
    </div>
  {:else if name === "plan_present"}
    <div class="grid gap-1.5">
      <Label>After approval switch to</Label>
      <SelectField
        items={leadProfiles.map((profile) => ({
          value: profile.name,
          label: profile.label,
        }))}
        value={String(settings.approvalProfile ?? "")}
        placeholder="Choose a profile"
        disabled={required("settings/approvalProfile")}
        ariaLabel="Profile after plan approval"
        onValueChange={(next) => patchSettings({ approvalProfile: next })}
      />
      <p class="text-ui text-muted-foreground">
        Chosen when the plan is presented, so editing this while you review it
        does not change where approval goes.
      </p>
    </div>
  {:else}
    <p class="text-ui text-muted-foreground">Nothing to configure.</p>
  {/if}
</div>
