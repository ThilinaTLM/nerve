<!--
  Add or edit one account, generated from its kind: a name, the kind's
  fields, and the secret. A stored secret is never shown; leaving the field
  blank keeps it. Adding offers the level ("Available to") and, for a kind
  that signs in, switches this same dialog to the sign-in after saving and
  closes it when the sign-in succeeds.
-->
<script lang="ts">
import {
  accountSecretFields,
  type AccountKind,
} from "@nervekit/contracts/extensions";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import RadioGroupField from "@nervekit/ui-kit/components/composites/radio-group-field";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { onDestroy } from "svelte";
import type { AccountView } from "$lib/api";
import { getCredentialKey, saveAccount } from "$lib/api";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import SettingsFormField from "../../shared/settings-form-field.svelte";
import AccountSignInPanel from "../accounts/AccountSignInPanel.svelte";
import { AccountSignInFlow } from "../accounts/account-sign-in.svelte";
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
  /** The open project, offered as a level when adding. */
  project?: { id: string; name: string };
  /** The kind is defined by the project's own extension, so its accounts stay in the project. */
  projectOnly?: boolean;
  onSaved: (account: AccountView) => void;
};
let {
  open = $bindable(false),
  kind,
  account,
  project,
  projectOnly = false,
  onSaved,
}: Props = $props();

const inputs = $derived(accountFormInputs(kind));
const secretInputs = $derived(Object.entries(accountSecretFields(kind)));
// Whether the account already holds its secrets, so the inputs may stay blank.
const credentialStored = $derived(
  account !== undefined && account.state !== "needs_sign_in",
);
let form = $state<AccountFormValues>({ name: "", fields: {}, secrets: {} });
let busy = $state(false);
let error = $state<string | undefined>();
let level = $state("user");
let lastOpen = false;

const signsIn = $derived(!account && kind.provider !== undefined);
const signInFlow = new AccountSignInFlow();
// After saving, the dialog shows the account's sign-in instead of the form.
let signingIn = $state<AccountView | undefined>();
onDestroy(() => void signInFlow.dispose());

$effect(() => {
  if (signingIn && signInFlow.flow?.state === "succeeded") void finishSignIn();
});

async function finishSignIn(): Promise<void> {
  await endSignIn();
  open = false;
}
async function endSignIn(): Promise<void> {
  signingIn = undefined;
  await signInFlow.close();
}
function cancel(): void {
  open = false;
  void endSignIn();
}
const levels = $derived([
  {
    value: "user",
    label: "User",
    detail: projectOnly
      ? "This extension is defined by the project"
      : "Available in every project",
    disabled: projectOnly,
  },
  ...(project
    ? [
        {
          value: "project",
          label: "Project only",
          detail: "Stored with the project’s settings on this machine",
        },
      ]
    : []),
]);

$effect(() => {
  if (open && !lastOpen) {
    form = initialAccountForm(kind, account);
    error = undefined;
    level = projectOnly && project ? "project" : "user";
    signingIn = undefined;
  }
  lastOpen = open;
});

async function save(): Promise<void> {
  const submission = submitAccountForm(kind, form, credentialStored);
  if (!submission.ok) {
    error = submission.message;
    return;
  }
  busy = true;
  error = undefined;
  try {
    const saved = await saveAccount({
      kind: kind.kind,
      ...(account
        ? { id: account.id }
        : level === "project" && project
          ? { projectId: project.id }
          : {}),
      name: submission.name,
      fields: submission.fields,
      ...(submission.secrets
        ? {
            secrets: Object.fromEntries(
              await Promise.all(
                Object.entries(submission.secrets).map(
                  async ([name, value]) => [
                    name,
                    await encryptApiKey(value, await getCredentialKey()),
                  ],
                ),
              ),
            ),
          }
        : {}),
    });
    onSaved(saved);
    if (signsIn && saved.state === "needs_sign_in") {
      signingIn = saved;
      await signInFlow.start(saved);
    } else open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not save account.";
  } finally {
    busy = false;
  }
}
</script>

<FormDialog
  bind:open
  title={signingIn
    ? `Sign in to ${signingIn.name}`
    : `${account ? "Edit" : "Add"} ${kind.label}`}
  description={signingIn
    ? "Complete the sign-in in your browser. Your credentials stay on this computer."
    : undefined}
  submitLabel={signingIn
    ? signInFlow.needsSubmit
      ? "Submit"
      : "Waiting for sign-in"
    : account
      ? "Save account"
      : signsIn
        ? "Add and sign in"
        : "Add"}
  submitDisabled={signingIn
    ? !signInFlow.needsSubmit || signInFlow.responseValue.trim().length === 0
    : false}
  {busy}
  {error}
  onSubmit={signingIn ? () => signInFlow.submitResponse() : save}
  onCancel={cancel}
  onOpenChange={(next) => {
    if (!next) void endSignIn();
  }}
>
  {#if signingIn}
    <AccountSignInPanel flow={signInFlow} />
  {:else}
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
    {#if !account && levels.length > 1}
      <SettingsFormField id={`account-${kind.kind}-level`} label="Available to">
        <RadioGroupField items={levels} bind:value={level} ariaLabel="Level" />
      </SettingsFormField>
    {/if}
    {#each secretInputs as [name, secret] (name)}
      {@const id = `account-${kind.kind}-secret-${name}`}
      <SettingsFormField {id} label={secret.label}>
        {#if secret.multiline}
          <Textarea
            {id}
            autocomplete="off"
            bind:value={form.secrets[name]}
            placeholder={credentialStored
              ? "Leave blank to keep the current one"
              : `Paste the ${secret.label}`}
          />
        {:else}
          <Input
            {id}
            type="password"
            autocomplete="off"
            bind:value={form.secrets[name]}
            placeholder={credentialStored
              ? "Leave blank to keep the current one"
              : `Paste the ${secret.label}`}
          />
        {/if}
        {#if secret.help}
          <p class="text-ui text-muted-foreground">
            {#each helpParts(secret.help) as part, index (index)}
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
    {/each}
  {/if}
</FormDialog>
