<!--
  Chooses what to add: the account kind and, with a project open, its level.
  A kind a project extension defines can only be added to that project.
-->
<script lang="ts">
import type { AccountKind } from "@nervekit/contracts/extensions";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import SettingsFormField from "../../shared/settings-form-field.svelte";

type Props = {
  open?: boolean;
  kinds: readonly AccountKind[];
  /** The extension that defines a kind; shown beside it, since several extensions can define accounts for one platform. */
  extensionName?: (kind: string) => string | undefined;
  /** The open project, offered as a level. */
  project?: { id: string; name: string };
  /** Kinds that only exist in the open project. */
  projectOnly: (kind: string) => boolean;
  /** The kind to start from, e.g. the only one the filters leave. */
  initialKind?: string;
  onChoose: (kind: AccountKind, projectId: string | undefined) => void;
};
let {
  open = $bindable(false),
  kinds,
  extensionName,
  project,
  projectOnly,
  initialKind,
  onChoose,
}: Props = $props();

let kind = $state("");
let level = $state<"user" | "project">("user");
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    kind =
      kinds.find((k) => k.kind === initialKind)?.kind ?? kinds[0]?.kind ?? "";
    level = "user";
  }
  lastOpen = open;
});

const pinned = $derived(projectOnly(kind));
const effectiveLevel = $derived(pinned ? "project" : level);

function submit(): void {
  const chosen = kinds.find((k) => k.kind === kind);
  if (!chosen) return;
  open = false;
  onChoose(
    chosen,
    effectiveLevel === "project" && project ? project.id : undefined,
  );
}
</script>

<FormDialog
  bind:open
  title="Add account"
  submitLabel="Continue"
  submitDisabled={!kind}
  onSubmit={submit}
>
  <SettingsFormField id="add-account-kind" label="Kind">
    <SelectField
      items={kinds.map((k) => ({
        value: k.kind,
        label: k.label,
        ...(extensionName?.(k.kind) ? { detail: extensionName(k.kind) } : {}),
      }))}
      bind:value={kind}
      ariaLabel="Account kind"
    />
  </SettingsFormField>
  {#if project}
    <SettingsFormField id="add-account-level" label="Level">
      <SelectField
        items={[
          {
            value: "user",
            label: "User",
            detail: "Available in every project",
          },
          {
            value: "project",
            label: project.name,
            detail: "Only in this project",
          },
        ]}
        value={effectiveLevel}
        disabled={pinned}
        onValueChange={(next) =>
          (level = next === "project" ? "project" : "user")}
        ariaLabel="Account level"
      />
      {#if pinned}
        <p class="text-ui text-muted-foreground">
          This kind is defined by the project, so its accounts stay in it.
        </p>
      {/if}
    </SettingsFormField>
  {/if}
</FormDialog>
