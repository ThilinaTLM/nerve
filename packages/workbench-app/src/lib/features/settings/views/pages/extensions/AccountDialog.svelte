<!--
  Add or edit one account, generated from its kind: a name, the kind's
  fields, and the secret. A stored secret is never shown; leaving the field
  blank keeps it.
-->
<script lang="ts">
import type { AccountKind } from "@nervekit/contracts/extensions";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { AccountView } from "$lib/api";
import { getCredentialKey, saveAccount } from "$lib/api";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import SettingsFormField from "../../shared/settings-form-field.svelte";
import {
  accountFormInputs,
  helpParts,
  initialAccountForm,
  type AccountFormValues,
  submitAccountForm,
} from "./account-form";

type Props = {
  open?: boolean;
  kind: AccountKind;
  /** The account being edited; absent when adding. */
  account?: AccountView;
  onSaved: (account: AccountView) => void;
};
let { open = $bindable(false), kind, account, onSaved }: Props = $props();

const inputs = $derived(accountFormInputs(kind));
let form = $state<AccountFormValues>({ name: "", fields: {}, secret: "" });
let busy = $state(false);
let error = $state<string | undefined>();
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    form = initialAccountForm(kind, account);
    error = undefined;
  }
  lastOpen = open;
});

async function save(): Promise<void> {
  const submission = submitAccountForm(
    kind,
    form,
    account?.secretConfigured ?? false,
  );
  if (!submission.ok) {
    error = submission.message;
    return;
  }
  busy = true;
  error = undefined;
  try {
    const saved = await saveAccount({
      kind: kind.kind,
      ...(account ? { id: account.id } : {}),
      name: submission.name,
      fields: submission.fields,
      ...(submission.secret
        ? {
            secret: await encryptApiKey(
              submission.secret,
              await getCredentialKey(),
            ),
          }
        : {}),
    });
    onSaved(saved);
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not save account.";
  } finally {
    busy = false;
  }
}
</script>

<FormDialog
  bind:open
  title={`${account ? "Edit" : "Add"} ${kind.label}`}
  submitLabel="Save account"
  {busy}
  {error}
  onSubmit={save}
>
  <SettingsFormField id={`account-${kind.kind}-name`} label="Account name">
    <Input
      id={`account-${kind.kind}-name`}
      bind:value={form.name}
      placeholder="Work"
    />
  </SettingsFormField>
  {#each inputs as input (input.key)}
    {@const id = `account-${kind.kind}-${input.key}`}
    <SettingsFormField {id} label={input.label}>
      {#if input.control === "switch"}
        <Switch
          checked={form.fields[input.key] === true}
          aria-label={input.label}
          onCheckedChange={(next) => (form.fields[input.key] = next)}
        />
      {:else if input.control === "select"}
        <SelectField
          items={input.options ?? []}
          value={String(form.fields[input.key] ?? "")}
          ariaLabel={input.label}
          onValueChange={(next) => (form.fields[input.key] = next)}
        />
      {:else}
        <Input
          {id}
          type={input.control === "number" ? "number" : "text"}
          placeholder={input.placeholder}
          bind:value={form.fields[input.key] as string}
        />
      {/if}
      {#if input.description}
        <p class="text-ui text-muted-foreground">{input.description}</p>
      {/if}
    </SettingsFormField>
  {/each}
  <SettingsFormField
    id={`account-${kind.kind}-secret`}
    label={kind.secret.label}
  >
    <Input
      id={`account-${kind.kind}-secret`}
      type="password"
      autocomplete="off"
      bind:value={form.secret}
      placeholder={account?.secretConfigured
        ? "Leave blank to keep the current one"
        : `Paste the ${kind.secret.label}`}
    />
    {#if kind.secret.help}
      <p class="text-ui text-muted-foreground">
        {#each helpParts(kind.secret.help) as part, index (index)}
          {#if part.href}
            <a
              class="text-info underline underline-offset-2"
              href={part.href}
              target="_blank"
              rel="noreferrer">{part.text}</a
            >
          {:else}{part.text}{/if}
        {/each}
      </p>
    {/if}
  </SettingsFormField>
</FormDialog>
