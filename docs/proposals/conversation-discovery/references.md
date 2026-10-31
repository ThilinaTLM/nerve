# Conversation references (GitHub PRs and issues)

v1 supports GitHub only. Identity, storage, and extraction are provider-neutral so that Jira, Linear, and similar trackers can be added later as new extractors, without schema changes.

## Model

A reference links one conversation to one external resource with one relationship.

| Field             | Meaning                                                           | GitHub v1                                                                                                 |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `provider`        | Resource system                                                   | `github`                                                                                                  |
| `resource_key`    | Canonical, provider-specific identity, unique within the provider | `<host>/<owner>/<repo>#<number>`, lowercased host/owner/repo. Example: `github.com/acme/api#481`          |
| `kind`            | Resource type                                                     | `pull_request`, `issue`, `unknown` (a qualified ref with no type cue; GitHub shares issue and PR numbers) |
| `relationship`    | How the conversation relates to it                                | `referenced` (a user prompt pointed to it) or `created` (this conversation created it)                    |
| `source_event_id` | The event that last set or upgraded the reference                 | user message or tool response event                                                                       |

Rules:

- **One reference per conversation per resource:** unique on `(conversation_id, provider, resource_key)`. Repeated mentions don't add rows.
- **Upgrade only:** a `referenced` reference becomes `created` when creation is verified. A later mention never downgrades `created`. `kind` can be refined from `unknown` to a concrete type, never the reverse.
- The same resource in two conversations is two rows. Creation applies only to the conversation where it happened.
- GitHub Enterprise hosts keep their own host. They're never normalized to `github.com`.
- Future providers define their own `resource_key` (for example `jira:<site>/APP-123`). A bare `APP-123` is resolved only with an unambiguous configured tracker context.

Images, documents, and file paths are not references.

## Extraction

Extraction is a pure, unit-testable module in conversation-core (`conversations/references/`). It runs on newly committed events, through upserts that are safe to repeat. There's no backfill of existing conversations and no network calls.

### Referenced: user prompts

Extraction runs on `user_message` events in root conversations, using the user-authored `originalText`. It ignores system-injected text, child-agent prompts, and expanded command or file content.

- Canonical URLs: `https://<host>/<owner>/<repo>/pull/<n>` → `pull_request`, `/issues/<n>` → `issue`. The query and fragment are ignored. Comment/review URLs resolve to their parent resource.
- Qualified shorthand: `owner/repo#n` → `unknown`, or `pull_request`/`issue` with an adjacent cue ("PR", "pull request", "issue").
- Bare `#n` with a type cue ("PR #481") only when the project has exactly one GitHub remote, which gives the repo context. Otherwise it's skipped.
- References inside fenced code blocks are skipped. This avoids picking up incidental references from pasted logs.
- The GitHub host must be `github.com` or a host from one of the project's git remotes (covers GitHub Enterprise without a new setting). Only `https` URLs are offered in the "Open on GitHub" menu.

### Created: `gh` commands

Extraction runs on settled tool responses from the bash tools (synchronous and async bash):

- The command contains `gh pr create` or `gh issue create`.
- The command completed successfully (exit code 0).
- The output contains a canonical PR/issue URL of the matching type. If there are several, use the last one, because `gh` prints the created URL last.

If all three match, the resource is upserted as `created`. Anything else (`gh pr view`, failed commands, wrappers or scripts with no matching command, assistant text containing URLs) is never treated as `created`. A missing tag is better than a false one.

Child agents: a resource created in a descendant conversation is also recorded on the root conversation as `created`, with the descendant's event as the source. This keeps the root card's tags accurate. Sibling conversations are not affected.

## Search

There's no server search operation. Summaries carry `references` (below), and the client already loads every root conversation summary for the project, so the smart search in [list-ux.md](list-ux.md#smart-search) matches references client-side. A term is normalized to a reference when it's a GitHub URL, `owner/repo#n`, `#n`, or `n`. `#n`/`n` match any repository's number `n`; qualified forms match exactly.

## Delivery to the client

Conversation summaries get a `references` array (provider, resourceKey, kind, relationship, url, label parts), ordered with created first and then by first-seen order. Upserts publish a normal summary update. These updates are metadata and don't change recency or unseen state.

## Tests

- URL/shorthand parsing: query and fragment stripping, comment URLs, PR vs. issue cues, `unknown` kind, enterprise host, bare `#n` with zero, one, or several remotes, code-fence skipping.
- One row per conversation and resource across repeated mentions and event replay. The same resource in two conversations gives two rows.
- `referenced` → `created` upgrade; no downgrade; `unknown` → concrete kind.
- `gh` detection: success plus URL is created; non-zero exit, `gh pr view`, an assistant claim, or no URL are not; child creation also appears on the root.
- Deleting a conversation removes its references (cascade).
