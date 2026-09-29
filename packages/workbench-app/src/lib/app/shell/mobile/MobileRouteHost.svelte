<script lang="ts">
import type { Component } from "svelte";
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import { mobileScreenLoaders } from "$lib/app/composition/mobile/mobile-screen-registry";
import MobileBranchesHost from "./MobileBranchesHost.svelte";
import MobileCenterRouteScreen from "./MobileCenterRouteScreen.svelte";
import MobileConversationScreen from "./MobileConversationScreen.svelte";
import MobileConversationsHost from "./MobileConversationsHost.svelte";
import MobileGitChangesHost from "./MobileGitChangesHost.svelte";
import MobileProjectHomeHost from "./MobileProjectHomeHost.svelte";
import MobilePullRequestsHost from "./MobilePullRequestsHost.svelte";
import type { MobileRoute } from "./mobile-routes";

/**
 * Route → screen. Screens that bind feature internals (files, notes, context,
 * tasks, logs, settings) live in the composition root and load on first use, so the
 * phone shell does not pull settings or log tooling into the startup bundle.
 */
let {
  route,
  visible,
  gitPanel,
}: {
  route: MobileRoute;
  visible: boolean;
  gitPanel: {
    readonly model: GitPanelModel;
    readonly actions: GitPanelActions;
  };
} = $props();
</script>

{#if route.kind === "project"}
  <MobileProjectHomeHost
    projectId={route.projectId}
    gitModel={gitPanel.model}
  />
{:else if route.kind === "conversations"}
  <MobileConversationsHost projectId={route.projectId} />
{:else if route.kind === "git"}
  <MobileGitChangesHost
    projectId={route.projectId}
    model={gitPanel.model}
    actions={gitPanel.actions}
  />
{:else if route.kind === "branches"}
  <MobileBranchesHost model={gitPanel.model} actions={gitPanel.actions} />
{:else if route.kind === "pull-requests"}
  <MobilePullRequestsHost model={gitPanel.model} actions={gitPanel.actions} />
{:else if route.kind === "center"}
  {#if route.identity.kind === "conversation" || route.identity.kind === "pending-conversation"}
    <MobileConversationScreen identity={route.identity} {visible} />
  {:else}
    <MobileCenterRouteScreen identity={route.identity} {visible} />
  {/if}
{:else}
  {#await mobileScreenLoaders[route.kind]()}
    <LazyViewPending />
  {:then module}
    {@const Screen = module.default as Component<{
      route: MobileRoute;
      visible: boolean;
    }>}
    <Screen {route} {visible} />
  {/await}
{/if}
