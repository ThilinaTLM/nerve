# Workspace tabs lost on reload

> **Status:** Bug report. Found while testing the conversation history work on dev slot 1. Not caused by that work; present since #473.

## Symptom

After a page reload or an app restart, every conversation tab of the **selected** project is closed. Tabs of other projects survive, and global tabs such as Settings survive.

## Reproduction

1. Start a dev instance (`desktop-dev-slot-1`) and select a project (here `Random`).
2. Close all tabs and open one conversation.
3. `localStorage["nerve.workspaceTabs.v3"].sessions["/home/tlm/Projects/Random"]` is:
   ```json
   {
     "tabs": [
       { "kind": "conversation", "id": "conv_01M6T5FYM81VSF0YVRB4MQ2J2G" }
     ],
     "active": {
       "kind": "conversation",
       "id": "conv_01M6T5FYM81VSF0YVRB4MQ2J2G"
     },
     "mru": ["conversation:conv_01M6T5FYM81VSF0YVRB4MQ2J2G"]
   }
   ```
4. Reload (`location.reload()`) or restart the app.
5. The session is now `{ "tabs": [], "mru": [] }` and no conversation tab is open.

This happens every time. In the same run, the `nerve` project, which was not selected, kept its conversation tab across a restart.

## Root cause

During startup the selected project's in-memory tab state is still empty when a cleanup step saves it, which overwrites the stored session.

All files below are under `packages/workbench-app/src/lib/application/`:

1. `startup/workbench-client.svelte.ts` calls `loadWorkspaceState()` on connect.
2. `workspace/workspace-actions.svelte.ts` `loadWorkspaceState` calls `hydrateWorkspaceTabSessions(..., { deferActivation: true })`.
   - It restores `selectedProjectKey` and `projectTabSessions` from storage.
   - It fills `openCenterTabs` only when there is no stored `selectedProjectKey`. For a selected project, `openCenterTabs` stays `[]`.
   - `selectedProjectId` is still `undefined`.
3. `loadWorkspaceState` then calls `closeRemovedProjectSettings()`, which ends with `removeTabsFromAllSessions(isRemoved)`.
4. `workspace/workspace-tab-sessions.ts` `removeTabsFromAllSessions` filters every session, then calls `recordTabsChanged()`.
5. `recordTabsChanged()` calls `saveVisibleProjectSession()`.
6. `saveVisibleProjectSession()` only checks `selectedProjectKey`. It writes the still-empty `openCenterTabs` into `projectTabSessions[selectedProjectKey]` and persists it.
7. Later `selectProject(..., { deferTabActivation: true })` applies the visible session. That session has already been emptied.

Only the selected project's key is written in step 6, which is why other projects are unaffected. Settings is stored in `globals`, not in a project session.

`selectProject` already guards its own save with `if (workspaceState.selectedProjectId) saveVisibleProjectSession()`. `saveVisibleProjectSession` itself has no such guard, so any caller during boot can overwrite the session.

`closeRemovedProjectSettings` was added in #473 (`f876aa028`).

## Proposed fix

Make `saveVisibleProjectSession` enforce the same rule as `selectProject`: until a project's session has been applied, the in-memory tabs are not that project's tabs and must not be saved.

```ts
export function saveVisibleProjectSession(): void {
  const key = workspaceState.selectedProjectKey;
  if (!key || !workspaceState.selectedProjectId) return;
  ...
}
```

Before landing, check that every other caller of `saveVisibleProjectSession` runs after a project is selected; mobile route activation and tab drag/reorder are the main ones to check.

**Alternative.** Apply the selected project's session before `closeRemovedProjectSettings` runs. This reorders boot and is a larger change.

## Tests

Add a unit test next to `workspace/tab-session-helpers.test.ts` / `workspace-tab-storage.test.ts`:

1. Seed storage with `selectedProjectKey = A` and a conversation tab in `sessions[A]`.
2. Call `hydrateWorkspaceTabSessions(..., { deferActivation: true })`.
3. Call `removeTabsFromAllSessions(() => false)`.
4. Assert that `sessions[A].tabs` and the persisted payload still contain the conversation tab.

## Release note

This affects users on the current release, so it is a candidate for a patch release.
