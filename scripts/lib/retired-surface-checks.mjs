const releaseSurfaceExtensions =
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|tsconfig(?:\.[^/]+)?\.json|Dockerfile|[^/]+\.(?:[cm]?[jt]sx?|svelte|md|json|ya?ml|toml|tf|sh))$/;

export function checkRetiredSurfaces({ files: trackedFiles, read }, fail) {
  checkRetiredSurface();
  checkRemovedPaths();

  function checkRetiredSurface() {
    const retiredPackages = [
      "@nervekit/" + "agent-runtime",
      "@nervekit/" + "agent-tools",
      "@nervekit/" + "orchestrator",
      "@nervekit/" + "host-runtime",
      "@nervekit/" + "process-runtime",
      "@nervekit/" + "workbench-ui",
      "packages/" + "agent-runtime",
      "packages/" + "agent-tools",
      "packages/" + "orchestrator",
      "packages/" + "host-runtime",
      "packages/" + "process-runtime",
      "packages/" + "workbench-ui",
    ];
    const retiredPathFragments = [
      "/protocol/" + "session.ts",
      "/protocol/" + "manager-protocol-session.ts",
    ];
    const retiredTextFragments = [
      "packages/contracts/src/domains/" + "protocol/",
    ];
    const retiredIdentifiers = [
      "class " + "TaskManager",
      "class " + "RunManager",
      "class " + "HarnessEventBridge",
      "class " + "AgentRunner",
      "class " + "AgentRunSession",
      "interface " + "AgentRunState",
      "type " + "AgentRunState",
      "legacy" + "NervePaths",
      "global" + "ProcessedSeqFromCursor",
      "function " + "launchDesktopRuntime",
    ];

    for (const file of trackedFiles.filter((path) =>
      releaseSurfaceExtensions.test(path),
    )) {
      const text = read(file);
      for (const name of retiredPackages) {
        if (file !== "docs/runbooks/release.md" && text.includes(name))
          fail(file, `retired package/path remains: ${name}`);
      }
      for (const fragment of retiredTextFragments) {
        if (text.includes(fragment))
          fail(file, `retired path reference remains: ${fragment}`);
      }
      for (const identifier of retiredIdentifiers) {
        if (text.includes(identifier))
          fail(file, `retired identifier remains: ${identifier}`);
      }
      if (
        /\brole\s*:\s*["'](?:orchestrator|agent)["']/.test(text) ||
        /"role"\s*:\s*"(?:orchestrator|agent)"/.test(text)
      )
        fail(file, "retired protocol role literal remains");
      if (
        /(?:class|interface|type)\s+ProtocolSession\b/.test(text) &&
        !file.startsWith("packages/protocol/")
      )
        fail(file, "duplicate local ProtocolSession lifecycle owner remains");
    }

    for (const file of trackedFiles) {
      for (const fragment of retiredPathFragments) {
        if (file.endsWith(fragment))
          fail(file, "retired protocol session path returned");
      }
    }
  }

  function checkRemovedPaths() {
    const removed = [
      "packages/workbench-app/src/lib/app/layout/ShellPanes.svelte",
      "packages/workbench-app/src/lib/app/layout/AppLayout.svelte",
      "packages/workbench-app/src/lib/app/layout/layout-state.svelte.ts",
      "packages/workbench-app/src/lib/app/layout/UtilityPanel.svelte",
      "packages/workbench-app/src/lib/app/layout/UtilityShell.svelte",
      "packages/workbench-app/src/lib/app/layout/utility-section-preferences.svelte.ts",
      "packages/workbench-app/src/lib/features/projects/components/ProjectAgentTree.svelte",
      "packages/workbench-app/src/lib/presentation/components/workbench/workbench-shell.svelte",
      "packages/workbench-app/src/lib/presentation/components/workbench/workbench-panes.svelte",
      "packages/workbench-app/src/lib/presentation/components/workbench/workbench-utility-panel.svelte",
      "packages/workbench-app/src/lib/presentation/components/workbench/panel-section.svelte",
      "packages/workbench-app/src/lib/presentation/components/workbench/workbench-layout.ts",
      "packages/workbench-app/src/lib/presentation/components/workbench/index.ts",
      "packages/ui-kit/src/styles/components/workbench-layout.css",
      "packages/ui-kit/src/styles/components/workbench-tabs.css",
      "packages/ui-kit/src/styles/components/workbench-utility.css",
      "packages/workbench-app/src/lib/features/conversations/components/composer-todos.ts",
      "packages/workbench-app/src/lib/features/git/components/git-change-format.ts",
      "packages/workbench-app/src/lib/features/git/components/git-remote-actions.ts",
      "packages/workbench-app/src/lib/features/git/components/pr-pane-helpers.ts",
      "packages/workbench-app/components.json",
      "packages/workbench-app/src/lib/core/highlight/highlight.ts",
      "packages/workbench-app/src/lib/core/highlight/highlight.test.ts",
      "packages/workbench-app/src/lib/core/utils/lru-cache.ts",
      "packages/workbench-app/src/lib/core/utils/lru-cache.test.ts",
      "packages/workbench-app/src/lib/core/utils/path-links.ts",
      "packages/workbench-app/src/lib/core/utils/path-links.test.ts",
      "packages/workbench-app/src/lib/core/utils/text-preview.ts",
      "packages/workbench-app/src/lib/core/utils/text-preview.test.ts",
      "packages/harness/src/compaction/types.ts",
      "packages/workbench-app/src/lib/presentation/conversations/types.ts",
      "packages/workbench-app/src/lib/presentation/files/types.ts",
      "packages/workbench-app/src/lib/presentation/settings/types.ts",
      "packages/workbench-app/src/lib/presentation/state/types.ts",
      "packages/workbench-app/src/lib/presentation/tools/lifecycle/types.ts",
      "packages/workbench-app/src/lib/application/workspace/workspace-feature-commands.ts",
      "packages/harness/src/harness/utils/shell-output.ts",
      "packages/harness/src/harness/utils/truncate.ts",
      "packages/desktop-shell/src/daemon-helpers.ts",
      "packages/desktop-shell/src/daemon/adapters/node-launcher.ts",
      "packages/workbench-server/src/app/runtime/types.ts",
      "packages/workbench-server/src/core/ports.ts",
      "packages/workbench-server/src/adapters/protocol/method-handlers.ts",
      "packages/workbench-server/src/adapters/protocol/method-handlers/conversation-agent-method-handlers.ts",
      "packages/workbench-server/src/adapters/protocol/method-handlers/project-task-method-handlers.ts",
      "packages/contracts/test/agent/agent.schema.test.ts",
      "packages/contracts/test/atlassian/atlassian-result-summaries.schema.test.ts",
      "packages/contracts/test/conversation/conversation-state.schema.test.ts",
      "packages/contracts/test/logs/logs.schema.test.ts",
      "packages/contracts/test/permission/permission-rule-sets.schema.test.ts",
      "packages/contracts/test/plan/plan-review.schema.test.ts",
      "packages/contracts/test/providers/providers.schema.test.ts",
      "packages/contracts/test/recorded/recorded-tool-name.schema.test.ts",
      "packages/contracts/test/storage/storage.schema.test.ts",
      "packages/contracts/test/task/task-definition.schema.test.ts",
      "packages/contracts/test/task/task-tool-preview.schema.test.ts",
      "packages/contracts/test/task/task.schema.test.ts",
      "packages/contracts/test/tool/tool-result-payload.schema.test.ts",
      "packages/contracts/test/wire-events/protocol.schema.test.ts",
      "packages/protocol/test/rpc/peer-binding.test.ts",
    ];
    for (const file of removed) {
      if (trackedFiles.includes(file))
        fail(file, "removed duplicate path returned");
    }
  }
}
