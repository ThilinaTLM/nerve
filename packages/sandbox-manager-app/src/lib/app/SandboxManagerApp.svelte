<script lang="ts">
import { ModeWatcher } from "mode-watcher";
import { Toaster } from "@nervekit/workbench-ui/components/ui/sonner";
import { useAppearance } from "../state/appearance.svelte";
import SandboxManagerProvider from "./SandboxManagerProvider.svelte";
import SandboxManagerShell from "../routes/SandboxManagerShell.svelte";

useAppearance();
</script>

<svelte:head>
  <title>nerve sandbox manager</title>
</svelte:head>

<ModeWatcher />

<SandboxManagerProvider>
  <SandboxManagerShell />
</SandboxManagerProvider>

<Toaster position="bottom-right" closeButton />
