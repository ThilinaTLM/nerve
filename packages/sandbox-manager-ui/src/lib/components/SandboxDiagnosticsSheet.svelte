<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
  } from "@nervekit/ui/components/ui/sheet";
  import type { SandboxDiagnosticTabId } from "../state/sandbox-ui-types";
  import WorkspaceInspector from "./workspace/WorkspaceInspector.svelte";

  let {
    open = $bindable(false),
    record,
    onOpenDiagnosticTab,
  }: {
    open?: boolean;
    record: ManagedSandboxRecord;
    onOpenDiagnosticTab: (id: SandboxDiagnosticTabId) => void;
  } = $props();

  function openDiagnostic(id: SandboxDiagnosticTabId): void {
    onOpenDiagnosticTab(id);
    open = false;
  }
</script>

<Sheet bind:open>
  <SheetContent side="right" class="w-[min(92vw,28rem)] gap-0 p-0">
    <SheetHeader class="sr-only">
      <SheetTitle>Sandbox inspector</SheetTitle>
      <SheetDescription>{record.sandboxId}</SheetDescription>
    </SheetHeader>
    <WorkspaceInspector
      {record}
      onClose={() => (open = false)}
      onOpenDiagnosticTab={openDiagnostic}
    />
  </SheetContent>
</Sheet>
