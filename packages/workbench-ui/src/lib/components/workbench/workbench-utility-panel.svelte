<script lang="ts" generics="T extends string = string">
import type { Snippet } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import Tabs, { type TabItem } from "@nervekit/ui-kit/components/ui/tabs-bar";

let {
  tabs = [],
  activeTab = $bindable<T>(),
  ariaLabel = "Utility panel tabs",
  onTabChange,
  children,
}: {
  tabs?: TabItem[];
  activeTab?: T;
  ariaLabel?: string;
  onTabChange?: (tab: T) => void;
  children: Snippet<[T]>;
} = $props();

function setTab(tab: string) {
  activeTab = tab as T;
  onTabChange?.(activeTab);
}
</script>

<aside class="utility-panel">
  <div class="utility-tabs">
    <Tabs {tabs} bind:value={activeTab} {ariaLabel} onValueChange={setTab} />
  </div>

  <ScrollArea
    class="utility-scroll"
    viewportClass="utility-content"
    type="auto"
  >
    {@render children(activeTab)}
  </ScrollArea>
</aside>
