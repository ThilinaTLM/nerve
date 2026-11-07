# Conversation defaults changes are not broadcast

> **Status:** Bug report. Found while testing the conversation history work on dev slot 1.

## Symptom

Turning on a model under **Settings → Models → Model scope** saves correctly: the page shows "Scoped 6" and `config/conversation-defaults.json` contains the new model. The conversation composer's model picker still offers the old list until the window is reloaded. Open conversations and new chats behave the same way.

## Reproduction

1. Open a conversation in any project. The picker lists five models.
2. Open **Settings → Models**, switch to **All** and check `Claude Haiku 5.5` (Anthropic).
3. Return to the conversation and open the model picker. Haiku is missing. Searching "haiku" shows "No models match."
4. Reload the window. Haiku is listed.

## Root cause

The server never publishes the creation-preferences signal, so `conversationDefaults.changed` is never sent.

- `packages/workbench-server/src/infrastructure/configuration/agent-configuration/agent-configuration-service.ts`:
  - declares `creationSignals = new ConfigurationSignals<PreferenceScope>()` and exposes `subscribeCreation()`;
  - `healthSignals.publish(...)` and `summarySignals.publish(...)` are called in several places, but `creationSignals.publish(...)` is called **nowhere**;
  - `saveCreation()` delegates to `saveCreationPreferences(...)` without publishing.
- `packages/workbench-server/src/adapters/protocol/configuration-notifications.ts` subscribes to `subscribeCreation` and would send `conversationDefaults.changed`. It never fires.
- Two client listeners already wait for that notice:
  - `features/settings/state/creation-preferences.svelte.ts` (`observe()`), which `ConversationCenterHost` uses for its project-scoped `creationDefaults`;
  - `application/agent-configuration/project-agent-defaults.svelte.ts`.

The Settings page looks correct only because `CreationPreferencesState.save()` reloads its own state after saving. Every other instance, such as the composer's, waits for the notice.

The signal was introduced in #481 (`ffc13978f`) without a publisher.

## Proposed fix

Publish the changed scope after a successful creation-preferences write. That covers saves, resets, and reloads where the document changed on disk. Two options:

- in `saveCreation()` after `saveCreationPreferences(...)` returns `saved`, call `this.creationSignals.publish(scope)`;
- or publish from the creation `ScopedDocumentStore` change path, so external edits and `agentConfiguration.reload` are covered too. This is preferred if the store already tracks generations.

A user-scope change affects the effective defaults of every project. The client listener reloads whatever scope it holds on any `conversationDefaults.changed` notice, so publishing `{ scope: "user" }` is enough.

## Tests

- **Server unit test:** saving creation preferences calls a `subscribeCreation` listener with the saved scope, and a rejected save (stale revision) does not.
- **Optional client test:** a `conversationDefaults.changed` notice makes `CreationPreferencesState` reload. This should already pass.
