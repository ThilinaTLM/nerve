# Conversation fork

> **Status:** Proposal. Split out of the conversation history and rewind work.

## Problem

Rewinding a conversation moves its head to an earlier entry and continues on a new branch, in the same conversation. Users sometimes want to keep the original conversation as it is and continue from an earlier point in a separate conversation: to try another approach in parallel, hand a variant to another worktree, or keep a clean copy before an experiment.

## Proposal

Add **Fork from here** next to **Rewind to here**. It creates a new top-level conversation whose history is the active path from the root to the chosen entry. The source conversation is not changed.

### What is copied

- **Events on the path.** Copy only the events from the root to the fork point. Side branches are not copied, so the new conversation starts with one straight branch and its head on the copied fork-point event.
- **Configuration.** Copy the project, working directory, profile, model, permission mode and context settings that apply at the fork point.
- **Sub-agents.** Copy each sub-agent conversation whose spawning `subagent_prompt` tool call is on the copied path, recursively for nested sub-agents. Copy its full active history: the parent already contains the sub-agent's reported result, so a cut-off child would contradict the parent. Sub-agents spawned after the fork point are not copied.
- **Managed files.** Copy tool output files, images and other assets referenced by copied events, or share them read-only if the storage model allows it.

### What is not copied

- Running state, queued inputs, pending approvals and questions, and background commands. The fork starts idle.
- Workspace files. A fork, like a rewind, only affects the conversation; the working tree is shared unless the user picks another working directory.

### Identity remapping

Every copied conversation, event and tool call gets a new ID. References are rewritten in one pass using an old → new map:

- event `parent_id` and the conversation `head_event_id`;
- a child's `parent_conversation_id` and `parent_tool_call_id`;
- agent IDs in the `subagent_prompt` tool call details and results, and in parent-conversation input events;
- asset and output-file references.

The copy runs in a single transaction, so a failed fork leaves nothing behind.

## Constraints

- **Only when not running.** Reuse `assertQuiescent` for the source conversation and every copied sub-agent.
- **Top-level only in the UI.** Sub-agent transcripts are read-only for history actions; forking starts from the root conversation.
- **No schema change by default.** The copy uses the existing tables. Show provenance by giving the fork a title such as `<title> (fork)` and adding a system event at the fork point that names the source conversation. A `forked_from_conversation_id` column is only worth adding if we need lineage queries, which would need separate approval.

## Open questions

- Fork title: suffix, prompt for a name, or auto-title from the next message.
- Whether a fork may target a different working directory or worktree when it is created.
- Whether copied managed files are duplicated or shared through reference counting.
- Sub-agents that kept running, or received follow-ups, after the fork point: copy their full history (proposed) or truncate at the last event the parent had seen at the fork point.
