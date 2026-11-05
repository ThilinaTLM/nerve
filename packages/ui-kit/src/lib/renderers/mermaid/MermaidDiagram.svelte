<script lang="ts">
import { downloadBlob } from "@nervekit/ui-kit/browser/download";
import { writeClipboardText } from "@nervekit/ui-kit/browser/clipboard";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import ZoomableMedia from "../media/ZoomableMedia.svelte";
import { mountMermaidSvg, renderMermaid } from "./mermaid-render.js";

type Props = {
  source: string;
  ariaLabel?: string;
  class?: string;
  defaultWheelZoomEnabled?: boolean;
  /** File name stem for downloads. */
  fileName?: string;
  onOpenStandalone?: () => void;
  /** Enables "Copy source" and reports the clipboard result. */
  onCopy?: (ok: boolean) => void;
};

let {
  source,
  ariaLabel = "Mermaid diagram",
  class: className = "",
  defaultWheelZoomEnabled = false,
  fileName = "diagram",
  onOpenStandalone,
  onCopy,
}: Props = $props();

let host = $state<HTMLElement | null>(null);
let renderState = $state<"loading" | "rendered" | "error">("loading");
let diagramWidth = $state(0);
let diagramHeight = $state(0);
let generation = 0;

function prepareDiagram(target: HTMLElement): boolean {
  const svg = target.querySelector<SVGSVGElement>("svg");
  const viewBox = svg?.viewBox.baseVal;
  if (!svg || !viewBox || viewBox.width <= 0 || viewBox.height <= 0)
    return false;
  diagramWidth = viewBox.width;
  diagramHeight = viewBox.height;
  target.style.width = `${diagramWidth}px`;
  target.style.height = `${diagramHeight}px`;
  svg.style.width = `${diagramWidth}px`;
  svg.style.height = `${diagramHeight}px`;
  svg.style.maxWidth = "none";
  return true;
}

async function render(nextSource: string, target: HTMLElement | null) {
  if (!target || !nextSource.trim()) {
    renderState = nextSource.trim() ? "loading" : "error";
    return;
  }
  const current = ++generation;
  renderState = "loading";
  target.replaceChildren();
  const result = await renderMermaid(nextSource, target);
  if (current !== generation || host !== target || !target.isConnected) return;
  if (
    !result.ok ||
    !mountMermaidSvg(target, result.svg) ||
    !prepareDiagram(target)
  ) {
    renderState = "error";
    return;
  }
  renderState = "rendered";
}

async function copySource() {
  try {
    await writeClipboardText(source);
    onCopy?.(true);
  } catch {
    onCopy?.(false);
  }
}

function downloadSvg() {
  const svg = host?.querySelector("svg");
  if (!svg) return;
  const markup = new XMLSerializer().serializeToString(svg);
  downloadBlob(
    new Blob([markup], { type: "image/svg+xml" }),
    `${fileName}.svg`,
  );
}

$effect(() => {
  void render(source, host);
});

$effect(() => {
  if (!host) return;
  const observer = new MutationObserver(() => void render(source, host));
  observer.observe(host.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  return () => {
    generation += 1;
    observer.disconnect();
  };
});
</script>

<ZoomableMedia
  class={className}
  {ariaLabel}
  contentWidth={diagramWidth}
  contentHeight={diagramHeight}
  ready={renderState === "rendered"}
  {defaultWheelZoomEnabled}
  copyLabel="Copy Mermaid source"
  onCopy={onCopy ? () => void copySource() : undefined}
  downloadLabel="Download SVG"
  onDownload={downloadSvg}
  openLabel="Open diagram in tab"
  {onOpenStandalone}
>
  <div class="mermaid-svg-host" bind:this={host}></div>
  {#snippet overlay()}
    {#if renderState === "loading"}
      <div
        class="pointer-events-none absolute inset-0 grid place-items-center text-ui text-muted-foreground"
      >
        <div class="grid place-items-center gap-2">
          <Spinner class="size-5 text-primary" />
          <span>Rendering diagram</span>
        </div>
      </div>
    {:else if renderState === "error"}
      <div class="absolute inset-0 grid place-items-center overflow-auto p-4">
        <div class="grid w-full max-w-3xl gap-3">
          <p class="m-0 text-ui text-destructive">
            Diagram could not be rendered
          </p>
          <pre class="m-0 overflow-auto rounded-md bg-well p-3 text-ui"><code
              >{source}</code
            ></pre>
        </div>
      </div>
    {/if}
  {/snippet}
</ZoomableMedia>

<style>
.mermaid-svg-host :global(svg) {
  display: block;
  max-width: none;
  height: auto;
  pointer-events: none;
}
</style>
