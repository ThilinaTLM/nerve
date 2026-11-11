<!-- The Kroki server URL field, shared by the diagram export and quick_script settings. -->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { defaultKrokiToolSettings } from "@nervekit/contracts/settings";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { isPublicKrokiUrl, isValidKrokiUrl } from "./kroki-server";

let {
  id,
  url,
  disabled = false,
  optional = false,
  onChange,
}: {
  id: string;
  url: string;
  disabled?: boolean;
  /** Empty is valid and means the default server. */
  optional?: boolean;
  onChange: (url: string) => void;
} = $props();
const effectiveUrl = $derived(
  optional && !url ? defaultKrokiToolSettings.url : url,
);
const valid = $derived(isValidKrokiUrl(effectiveUrl));
</script>

<div class="grid gap-1.5">
  <Label for={id}>Kroki server</Label>
  <Input
    {disabled}
    {id}
    class="font-mono"
    value={url}
    aria-invalid={valid ? undefined : "true"}
    placeholder={defaultKrokiToolSettings.url}
    oninput={(event) => onChange(event.currentTarget.value)}
  />
  {#if !valid}
    <p class="text-ui text-destructive">
      Enter an HTTP(S) URL without credentials, query parameters, or fragments.
    </p>
  {/if}
</div>
{#if isPublicKrokiUrl(effectiveUrl)}
  <Callout
    layout="block"
    tone="warning"
    text="The public Kroki server receives your diagram source. Use your own server for private diagrams."
  />
{/if}
