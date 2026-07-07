<script lang="ts">
  import { Boxes, Monitor, Moon, Settings2, Sun } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/ui/components/ui/status-dot";
  import { useAppearance, type ThemePreference } from "../../state/appearance.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import type { SandboxManagerRouteState } from "../../routes/route-state.svelte";

  let { route }: { route: SandboxManagerRouteState } = $props();

  const store = useSandboxManagerStore();
  const appearance = useAppearance();

  const connectionTone = $derived<StatusTone>(
    store.connection === "live"
      ? "good"
      : store.connection === "connecting" || store.connection === "reconnecting"
        ? "running"
        : store.connection === "error"
          ? "danger"
          : "neutral",
  );

  const navItems = [
    {
      kind: "fleet" as const,
      label: "Sandboxes",
      icon: Boxes,
      onSelect: () => route.fleet(),
    },
    {
      kind: "settings" as const,
      label: "Settings",
      icon: Settings2,
      onSelect: () => route.openSettings(),
    },
  ];

  function isActive(kind: string): boolean {
    if (kind === "fleet")
      return route.kind === "fleet" || route.kind === "sandbox";
    return route.kind === kind;
  }

  const themeOrder: ThemePreference[] = ["system", "light", "dark"];
  const themeIcon = $derived(
    appearance.preference === "light"
      ? Sun
      : appearance.preference === "dark"
        ? Moon
        : Monitor,
  );
  function cycleTheme(): void {
    const index = themeOrder.indexOf(appearance.preference);
    appearance.setPreference(themeOrder[(index + 1) % themeOrder.length]);
  }
</script>

<nav
  class="flex h-svh w-14 flex-none flex-col items-center gap-1 border-r bg-card py-3"
  aria-label="Primary"
>
  <button
    type="button"
    class="mb-2 flex size-10 items-center justify-center rounded-md text-primary hover:bg-muted"
    aria-label="Sandbox Manager home"
    onclick={() => route.fleet()}
  >
    <Boxes class="size-6" />
  </button>

  {#each navItems as item (item.kind)}
    {@const Icon = item.icon}
    {@const active = isActive(item.kind)}
    <div class="relative flex w-full justify-center">
      {#if active}
        <span
          class="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          aria-hidden="true"
        ></span>
      {/if}
      <Button
        variant={active ? "secondary" : "ghost"}
        size="icon"
        {active}
        ariaLabel={item.label}
        title={item.label}
        aria-current={active ? "page" : undefined}
        onclick={item.onSelect}
      >
        <Icon class="size-5" />
      </Button>
    </div>
  {/each}

  <div class="flex-1"></div>

  <div class="flex flex-col items-center gap-2 pb-1">
    <div title={`Connection: ${store.connection}`} class="flex size-8 items-center justify-center">
      <StatusDot
        tone={connectionTone}
        pulse={store.connection === "reconnecting" ||
          store.connection === "connecting"}
      />
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel={`Theme: ${appearance.preference}`}
      title={`Theme: ${appearance.preference}`}
      onclick={cycleTheme}
    >
      {@const Icon = themeIcon}
      <Icon class="size-4" />
    </Button>
  </div>
</nav>
