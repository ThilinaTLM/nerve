<script lang="ts">
  import { Monitor, Moon, Sun } from "@lucide/svelte";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "@nervekit/ui/components/ui/card";
  import { cn } from "@nervekit/ui/core/utils";
  import {
    useAppearance,
    type ThemePreference,
  } from "../../state/appearance.svelte";

  const appearance = useAppearance();

  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
</script>

<Card class="border">
  <CardHeader class="border-b p-4">
    <CardTitle class="text-base">Appearance</CardTitle>
    <CardDescription>Choose how the sandbox manager looks on this device.</CardDescription>
  </CardHeader>
  <CardContent class="p-4">
    <div role="radiogroup" aria-label="Theme" class="grid gap-3 sm:grid-cols-3">
      {#each options as option (option.value)}
        {@const Icon = option.icon}
        {@const selected = appearance.preference === option.value}
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          class={cn(
            "flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-sm transition-colors",
            selected
              ? "border-primary ring-1 ring-primary"
              : "hover:border-primary/40 hover:bg-accent/40",
          )}
          onclick={() => appearance.setPreference(option.value)}
        >
          <Icon class="size-5 text-muted-foreground" />
          <span class="font-medium">{option.label}</span>
        </button>
      {/each}
    </div>
  </CardContent>
</Card>
