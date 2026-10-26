<script lang="ts">
import { userSettingsScope } from "$lib/features/settings/registry/settings-scope";
import MobileSettingsPageScreen from "./MobileSettingsPageScreen.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

let { route }: MobileScreenProps<"settings-page"> = $props();
</script>

<MobileSettingsPageScreen
  target={userSettingsScope}
  pageId={route.pageId}
  backLabel="Back to settings"
/>
