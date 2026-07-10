<script lang="ts">
import SandboxCenter from "../app/SandboxCenter.svelte";
import CreateSandboxDialog from "../components/create/CreateSandboxDialog.svelte";
import { useSandboxCenter } from "../state/sandbox-center.svelte";
import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

const store = useSandboxManagerStore();
const center = useSandboxCenter();
</script>

<SandboxCenter />

<CreateSandboxDialog
  bind:open={store.createDialogOpen}
  onCreated={(sandboxId) => center.openSandbox(sandboxId)}
/>
