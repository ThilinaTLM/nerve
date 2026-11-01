<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { HtmlPreviewViewModel } from "./file-pane-contracts.js";
import { isHtmlPreviewResourceMessage } from "./html-preview-message.js";

let {
  preview,
  title,
  unavailable,
  dirty,
  onResourceMessage,
  onRetry,
}: {
  preview?: HtmlPreviewViewModel;
  title: string;
  unavailable?: string;
  dirty?: boolean;
  onResourceMessage?: (data: unknown) => void;
  onRetry?: () => void;
} = $props();
let frame: HTMLIFrameElement | undefined = $state();
function receive(event: MessageEvent) {
  if (
    !frame?.contentWindow ||
    event.source !== frame.contentWindow ||
    !preview?.url
  )
    return;
  if (
    isHtmlPreviewResourceMessage(
      event,
      frame.contentWindow,
      window.location.origin,
    )
  )
    onResourceMessage?.(event.data);
}
</script>

<svelte:window onmessage={receive} />
<div class="flex min-h-0 min-w-0 flex-col">
  <div
    class="border-b border-border/60 bg-panel px-4 py-2 text-ui text-muted-foreground"
  >
    {#if dirty}<p class="m-0 mb-1">Previewing unsaved changes.</p>{/if}
    <div class="flex items-start justify-between gap-2">
      <details class="min-w-0 flex-1">
        <summary class="cursor-pointer">
          Isolated HTML preview · {preview?.blocked
            ? "remote resources blocked"
            : "remote resources require permission"}
        </summary>
        <p class="m-0 mt-2">
          Relative project assets and inline scripts are supported. Network APIs
          and navigation are unsupported. Scripts may still attempt self-frame
          navigation; this is not a universal network firewall. Approved loads
          can transmit information. Approval reloads the preview; changing the
          source or draft, or closing preview, resets permissions.
          Blocked-resource reporting is best-effort.
        </p>
        {#if preview?.blocked}
          <p class="m-0 mt-2">
            Remote resources are blocked pending permission or were declined.
          </p>
        {/if}
      </details>
      {#if !unavailable}
        <Button
          variant="outline"
          size="sm"
          disabled={preview?.loading}
          onclick={onRetry}>Retry blocked resources</Button
        >
      {/if}
    </div>
  </div>
  {#if unavailable || preview?.error}
    <div
      class="grid min-h-0 flex-1 place-content-center gap-2 p-4 text-center text-ui text-muted-foreground"
    >
      <p class="m-0">{unavailable ?? preview?.error}</p>
      {#if !unavailable}<Button variant="outline" onclick={onRetry}
          >Retry preview</Button
        >{/if}
    </div>
  {:else if preview?.loading || !preview?.url}
    <div
      class="grid min-h-0 flex-1 place-content-center gap-2 p-4 text-center text-ui text-muted-foreground"
    >
      <Spinner class="mx-auto size-5" />
      <p class="m-0">Preparing HTML preview…</p>
    </div>
  {:else}
    {#key preview.url}
      <iframe
        bind:this={frame}
        src={preview.url}
        sandbox="allow-scripts"
        {title}
        class="min-h-0 w-full flex-1 border-0"
        referrerpolicy="no-referrer"
      ></iframe>
    {/key}
  {/if}
</div>
