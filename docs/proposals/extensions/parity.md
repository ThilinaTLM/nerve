# Direct-tool parity

Part of [Extensions](README.md). Gate for delivery step 5.

Every direct tool removed in step 5 maps to a typed SDK method or a raw-request recipe. "Today" lists what the SDK method is authorized as now (from the method tables in [`quick-script/`](../../../packages/quick-script/src/)). The rule and exception migration in [permissions.md](permissions.md#migration) is generated from this table.

**Gaps** are closed in step 5 before any tool is removed. A gap is either a new typed method or a recipe in the extension's raw-request docs.

## Jira

| Direct tool                | SDK route                                                        | Gap                                                                                    |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `jira_search_users`        | `jira.users.search`, `jira.users.me`                             |                                                                                        |
| `jira_search_issues`       | `jira.issues.search`                                             |                                                                                        |
| `jira_get_issue`           | `jira.issues.get`, `jira.attachments.list`, `jira.worklogs.list` |                                                                                        |
| `jira_get_project`         | `jira.projects.get`, `jira.projects.list`, `jira.fields.list`    |                                                                                        |
| `jira_search_boards`       | `jira.projects.get({ include: ["boards"] })`                     | Boards across projects or by name: add a `GET /rest/agile/1.0/board` recipe            |
| `jira_get_board`           | —                                                                | Board by id and configuration: add recipe (`/board/{id}`, `/board/{id}/configuration`) |
| `jira_get_sprint`          | `jira.sprints.issues`, `projects.get({ include: ["sprints"] })`  |                                                                                        |
| `jira_download_attachment` | `jira.attachments.download`                                      |                                                                                        |
| `jira_create_issue`        | `jira.issues.create`                                             |                                                                                        |
| `jira_update_issue`        | `jira.issues.update`, `jira.issues.delete`                       |                                                                                        |
| `jira_transition_issue`    | `jira.issues.transition`                                         |                                                                                        |
| `jira_manage_comment`      | `jira.comments.add` / `update` / `delete`                        |                                                                                        |
| `jira_manage_worklog`      | `jira.worklogs.add` / `update` / `delete`                        |                                                                                        |
| `jira_manage_issue_link`   | `jira.issues.link`, `jira.issues.unlink`                         |                                                                                        |
| `jira_manage_attachment`   | `jira.attachments.upload` / `delete`                             |                                                                                        |
| `jira_manage_sprint`       | `jira.sprints.create` / `update` / `start` / `close` / `delete`  |                                                                                        |
| `jira_manage_backlog`      | `jira.issues.move`, `jira.issues.rank`                           | Confirm `move` covers both `move_to_backlog` and `move_to_sprint`                      |

## Confluence

| Direct tool                     | SDK route                                                             | Gap                                                                        |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `confluence_search_spaces`      | `confluence.spaces.search`                                            |                                                                            |
| `confluence_search_pages`       | `confluence.pages.search`, `pages.get` by title                       |                                                                            |
| `confluence_get_page`           | `confluence.pages.get`, `comments.list`, `attachments.list`           |                                                                            |
| `confluence_download_page`      | `confluence.pages.download`                                           |                                                                            |
| `confluence_create_page`        | `confluence.pages.create`                                             |                                                                            |
| `confluence_update_page`        | `confluence.pages.update`, `pages.move`                               |                                                                            |
| `confluence_manage_comment`     | `confluence.comments.add` / `reply` / `update` / `delete` / `resolve` | `reopen`: confirm `resolve` covers it (it documents "resolves or reopens") |
| `confluence_manage_page`        | `confluence.pages.delete` (`purge`), `pages.restore`                  |                                                                            |
| `confluence_manage_label`       | `confluence.labels.add` / `remove`                                    |                                                                            |
| `confluence_manage_restriction` | Raw recipe (exists): `restriction/byOperation`                        | `clear_operation`: add to the recipe                                       |
| `confluence_manage_attachment`  | `confluence.attachments.upload` / `delete`                            | `rename` is a raw recipe (exists)                                          |

## Other

| Direct tool      | SDK route           | Gap                                                     |
| ---------------- | ------------------- | ------------------------------------------------------- |
| `kroki_export`   | `diagram.render`    |                                                         |
| `generate_image` | `imagegen.generate` | New namespace ([extensions.md](extensions.md#imagegen)) |
