# User visibility

Part of [self-configuration](README.md). Current behavior: [trust and consent](../../architecture/trust.md), [settings UI](../../ui/settings.md).

## Problem

The agent creates and edits configuration on the user's behalf, and repositories bring their own. The user needs one answer to two questions: what is broken, and what is waiting for me?

Today the answer is spread out:

| What                                                                             | Where the user finds out                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Project permission overlay, project preferences, project profiles awaiting trust | Settings → This project → Trust                        |
| Prompt-suggestion predicate awaiting approval                                    | Settings → Suggestions                                 |
| Extension awaiting consent, invalid or incompatible                              | Settings → Extensions                                  |
| Skill with invalid frontmatter                                                   | Settings → Skills                                      |
| Project skill and the scripts beside it                                          | Nowhere; it is used as soon as the project opens       |
| Invalid user settings file, project configuration issue                          | The bell (Activity), with a toast when the set changes |
| Invalid rule set or launch catalog                                               | A blocked tool call, or the page that edits that file  |

Two more gaps:

- Only settings files reach the bell. After a Nerve update that breaks an extension, the extension is simply gone until the user opens Settings → Extensions.
- The gear opens user settings. Project skills, project extensions, project profiles and Trust exist only in project settings, reached through one small "Project settings" link above the navigation.

## Proposal

### The bell is the one list

The Activity popover already holds persistent entries for settings files that need attention ([`SettingsHealthItem`](../../../packages/workbench-app/src/lib/presentation/activity/SettingsHealthItem.svelte), [`ProjectConfigurationHealthItem`](../../../packages/workbench-app/src/lib/presentation/activity/ProjectConfigurationHealthItem.svelte)), and a toast fires when the set changes. That mechanism is extended, not duplicated: no new page and no new notice.

- **Entries come from the [resource registry](configuration-model.md#resource-providers).** A resource gets an entry when its state is `invalid`, `incompatible` or `needs_approval`, or it has an `error` diagnostic. User scope and the open project, every kind.
- **Two groups:** waiting for your review, and not working.
- **Each entry says** what it is, where it comes from (the project, from the repository; or yours, every project), and the diagnostic's own words.
- **Actions.** "Review" opens the item's review in the settings scope it belongs to. "Ask the agent to fix" or "Ask the agent to upgrade" starts a conversation in the Forge profile with the item's kind, id, path and diagnostics as the prompt; it grants nothing. The existing Reload and Reset actions of settings files stay.
- **Toast** when a project opens or Nerve starts with a different set of items, as the settings-health toast does today. After an update that leaves extensions unable to load, it names the cause.
- **The agent's hand-over.** The skill ends a configuration task by reading `configuration.list` for items in `needs_approval` and telling the user exactly those, instead of recalling them from the conversation.

### Finding project settings

1. **Both scopes in the scope header.** The header above the settings navigation lists "Your settings" and the open project as two rows, replacing the single link. The project row carries the count of items that need the user.
2. **Counts on navigation rows.** A page with pending items shows the count (`SettingsNavBadge`, which exists).
3. **Guide rows on user pages.** A user page whose project counterpart has content (Skills, Extensions, Agents, Sub-Agents, Permission rules, Suggestions) ends with a section "In this project": one row naming what the project has, with pending items as its problem line, that opens the project page. Absent without an open project or when the project has none.
4. **The gear keeps opening user settings.** A gear that lands in different places is harder to learn; the aids above and the bell's "Review" are the routes to the project.
5. **Deep links.** "Review" from the bell lands on the item in the right scope, so the user never has to know which scope holds it.

## Rules

- Entries are computed from the registry. No stored "seen" state and no database change; the toast compares against the set held in memory since startup, as it does today.
- Approval is never given from the list by the agent or by a bulk action. Trust and consent keep their per-item review ([trust](../../architecture/trust.md): a path from an agent surface to trust is never allowed).
- A project-scope item says that it comes from the repository, since a repository is an untrusted source.
- Warnings do not create an entry or count toward a badge. They show on the item's own page and to the agent.

## Project skills need approval

Challenges a current rule: [trust](../../architecture/trust.md) says skills are not trusted resources because they are instructions, not code. A skill folder can hold scripts the skill tells the agent to run, and the user never sees them. So a skill that arrives with a repository is treated like the other project files.

- **New trust kind `project_skill`**, one row per skill folder. Adding a kind is an enum value in contracts and needs no table change.
- **Covers** skills under `<project>/.nerve/skills/` and `.agents/skills/` in the project and its ancestors. User-scope and built-in skills need no approval: the user put them there.
- **Digest** covers every file in the skill folder that the skill loader does not ignore, by relative path, as the extension digest does for `dist/`. Any change asks again.
- **Review page** (Project settings › Skills › name): what the agent is told (the name and description, which is all that enters its instructions), then every file with scripts marked, each one click away. The full `SKILL.md` is not inlined, so the file list and its scripts stay in view.
- **Until approved**, the skill is not advertised to the agent and cannot be applied. It has an entry in the bell, and its review page lists every file with scripts called out.
- **The agent cannot approve.** A skill the agent writes at project scope waits for the user like any other project file; the skill's hand-over says so. At user scope it works at once, which makes user scope the default for a personal skill.
- **Upgrade.** Existing project skills become pending on the first start after this ships. The start-up toast and the bell name them, so nothing disappears silently.

## Wireframes

Design Lab prototypes built from the production components with mock data, as [`packages/workbench-app/AGENTS.md`](../../../packages/workbench-app/AGENTS.md) prescribes. They live in the gitignored `packages/workbench-app/src/lib/app/design-lab/wireframes/`, so they exist only in the checkout where they were drawn; run the UI dev server and open the path.

| Path                                    | Shows                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dev/wireframes/attention-inbox`       | The bell with review and not-working entries beside today's settings-health entry, the two toasts, the empty state                                        |
| `/dev/wireframes/settings-scope-guides` | Scope header with both scopes, navigation counts, the "In this project" guide row on user Skills, the project Skills page with a skill waiting for review |
| `/dev/wireframes/skill-review`          | Project settings › Skills › name: first review, changed since approval, invalid, approved                                                                 |

No new component or token: `NotificationEntry`, `SettingsNav`, `SettingsItem`, `SettingsList`, `SettingsSection`, `SettingsPageHeader`, `SelectRow`, `Callout`, `Badge`. The scope header's two rows are the one change to an existing component (`SettingsNav`'s header).
