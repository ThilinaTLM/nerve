<!--
  An action that applies to a layer (New profile, New suggestion): a plain
  button without a project, a User / <project> dropdown with one. Lives in the
  page header's actions.
-->
<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import type { Component } from "svelte";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import type { SettingsLayer } from "./settings-origin";

type Props = {
  label: string;
  icon?: Component<{ class?: string }>;
  variant?: "outline" | "ghost";
  /** The open project's name; without one the action is a plain button. */
  projectName?: string;
  /** Only the project layer exists for this action. */
  projectOnly?: boolean;
  onSelect: (layer: SettingsLayer) => void;
};

let {
  label,
  icon: Icon,
  variant = "outline",
  projectName,
  projectOnly = false,
  onSelect,
}: Props = $props();
</script>

{#if !projectName || projectOnly}
  <Button
    size="sm"
    {variant}
    onclick={() => onSelect(projectOnly && projectName ? "project" : "user")}
    >{#if Icon}<Icon class="size-3.5" />{/if}{label}</Button
  >
{:else}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={buttonVariants({ variant, size: "sm" })}>
      {#if Icon}<Icon class="size-3.5" />{/if}{label}<ChevronDown
        class="size-3.5 text-muted-foreground"
      />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-48">
      <DropdownMenu.Item onSelect={() => onSelect("user")}
        >User</DropdownMenu.Item
      >
      <DropdownMenu.Item onSelect={() => onSelect("project")}
        >{projectName}</DropdownMenu.Item
      >
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
