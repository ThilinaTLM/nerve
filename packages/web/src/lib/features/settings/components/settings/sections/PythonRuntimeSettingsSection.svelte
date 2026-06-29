<script lang="ts">
  import type { Settings, StatusResponse, UpdateSettingsRequest } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type Props = {
    settingsDraft: Settings;
    status?: StatusResponse;
    onSettingsChange?: SettingsChange;
  };

  let { settingsDraft, status, onSettingsChange }: Props = $props();

  const python = $derived(status?.runtime.python);
  const manualPath = $derived(settingsDraft.runtime.pythonExecutablePath ?? "");
  const sourceLabel = $derived((python?.source ?? "unavailable").replace(/_/g, " "));

  function updatePythonPath(value: string) {
    const next = value.trim().length > 0 ? value : undefined;
    settingsDraft.runtime.pythonExecutablePath = next;
    onSettingsChange?.(
      { runtime: { pythonExecutablePath: next ?? null } },
      { debounceMs: 650 },
    );
  }

  function resetPythonPath() {
    settingsDraft.runtime.pythonExecutablePath = undefined;
    onSettingsChange?.(
      { runtime: { pythonExecutablePath: null } },
      { immediate: true },
    );
  }
</script>

<section id="settings-python" class="settings-section" data-section="python">
  <header class="settings-section-header">
    <h2>Python</h2>
  </header>

  <div class="settings-section-body">
    <div class="stat-grid">
      <section>
        <span>Status</span>
        <strong>{python?.available ? "available" : "unavailable"}</strong>
      </section>
      <section>
        <span>Source</span>
        <strong>{sourceLabel}</strong>
      </section>
      <section>
        <span>Version</span>
        <strong>{python?.version ?? "—"}</strong>
      </section>
      <section class="wide">
        <span>Executable</span>
        <strong title={python?.executable}>{python?.executable ?? "—"}</strong>
      </section>
      {#if python?.error}
        <section class="wide">
          <span>Validation</span>
          <strong title={python.error}>{python.error}</strong>
        </section>
      {/if}
    </div>

    <div class="settings-row settings-row-stacked">
      <div class="settings-copy">
        <strong>Manual executable path</strong>
      </div>
      <div class="settings-field-grid">
        <label class="wide">
          <span>Python executable</span>
          <Input
            value={manualPath}
            size="sm"
            placeholder="Auto-detect"
            ariaLabel="Python executable path"
            oninput={(event) => updatePythonPath((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div>
        <Button size="sm" variant="outline" onclick={resetPythonPath}>Reset to auto-detect</Button>
      </div>
    </div>

    <p class="settings-note">Planning-mode Python runs with file-write guardrails. This is not a hard security sandbox.</p>
  </div>
</section>
