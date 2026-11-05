<script lang="ts">
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";

type Props = {
  open?: boolean;
  title: string;
  label: string;
  submitLabel?: string;
  initialName: string;
  onSubmit: (name: string) => Promise<boolean>;
};

let {
  open = $bindable(false),
  title,
  label,
  submitLabel = "Save",
  initialName,
  onSubmit,
}: Props = $props();

let name = $state("");
let busy = $state(false);

$effect(() => {
  if (open) name = initialName;
});

async function submit() {
  busy = true;
  try {
    if (await onSubmit(name.trim())) open = false;
  } finally {
    busy = false;
  }
}
</script>

<FormDialog
  bind:open
  {title}
  {submitLabel}
  {busy}
  submitDisabled={!name.trim()}
  onSubmit={submit}
>
  <div class="grid gap-1.5">
    <Label for="access-name-field">{label}</Label>
    <Input
      id="access-name-field"
      value={name}
      oninput={(event) => (name = event.currentTarget.value)}
      maxlength={80}
      autocomplete="off"
    />
  </div>
</FormDialog>
