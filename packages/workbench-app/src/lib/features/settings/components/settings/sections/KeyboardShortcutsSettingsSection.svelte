<script lang="ts">
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutCategory,
  type ShortcutCommand,
} from "$lib/core/shortcuts/registry";
import { formatShortcut } from "$lib/core/shortcuts/keyboard";

const shortcutGroups = DEFAULT_SHORTCUTS.reduce<
  Array<{ category: ShortcutCategory; commands: ShortcutCommand[] }>
>((groups, command) => {
  const group = groups.find(
    (candidate) => candidate.category === command.category,
  );
  if (group) group.commands.push(command);
  else groups.push({ category: command.category, commands: [command] });
  return groups;
}, []);
</script>

{#each shortcutGroups as group, index (group.category)}
  <SettingsSectionCard
    section={index === 0
      ? "keyboard-shortcuts"
      : `keyboard-shortcuts-${group.category.toLowerCase()}`}
    title={group.category}
  >
    <dl class="divide-y divide-border/60">
      {#each group.commands as command (command.id)}
        <div class="settings-row">
          <dt class="text-sm text-foreground">{command.label}</dt>
          <dd>
            <Kbd>{formatShortcut(command.defaultBinding)}</Kbd>
          </dd>
        </div>
      {/each}
    </dl>
  </SettingsSectionCard>
{/each}
