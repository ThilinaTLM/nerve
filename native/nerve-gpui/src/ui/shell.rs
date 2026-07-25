use gpui::{Context, Entity, IntoElement, Render, Task, Window, div, prelude::*, px};
use gpui_component::input::{Input, InputState};

use super::theme;
use crate::{
    Options, daemon::DaemonConnection, evaluation::EvaluationScene,
    protocol::client::ReadOnlyProtocolClient, state::workspace::WorkspaceState,
};

pub(crate) struct NativeWorkbench {
    evaluation: EvaluationScene,
    status: String,
    connection_hint: String,
    workspace: WorkspaceState,
    composer: Entity<InputState>,
    _load_task: Option<Task<()>>,
}

impl NativeWorkbench {
    pub(crate) fn new(options: &Options, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (status, client) = if options.evaluation {
            (
                "Deterministic evaluation mode · no daemon mutations".to_owned(),
                None,
            )
        } else {
            match DaemonConnection::resolve(options).and_then(|connection| {
                connection.authorization_headers()?;
                let status = format!("Connecting read-only client · {}", connection.base_url);
                Ok((status, Some(ReadOnlyProtocolClient::new(connection))))
            }) {
                Ok(result) => result,
                Err(error) => (format!("Daemon unavailable · {error}"), None),
            }
        };
        let connection_hint = client.as_ref().map_or_else(
            || "offline".to_owned(),
            |client| client.websocket_url().to_string(),
        );
        let load_task = client.map(|mut client| {
            cx.spawn(async move |this, cx| {
                let result = cx
                    .background_spawn(async move {
                        let runtime = tokio::runtime::Runtime::new()?;
                        runtime.block_on(client.load_workspace_snapshot())
                    })
                    .await;
                if let Some(this) = this.upgrade() {
                    this.update(cx, |workbench, cx| {
                        match result.and_then(|value| {
                            WorkspaceState::from_snapshot_result(value).map(|(state, _)| state)
                        }) {
                            Ok(workspace) => {
                                workbench.status = format!(
                                    "Live read-only snapshot · {} projects · {} conversations",
                                    workspace.projects.len(),
                                    workspace.conversations.len()
                                );
                                workbench.workspace = workspace;
                            }
                            Err(error) => {
                                workbench.status = format!("Protocol connection failed · {error}");
                            }
                        }
                        cx.notify();
                    })
                    .ok();
                }
            })
        });
        let composer = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .placeholder("Type to evaluate native text input, selection, clipboard, and IME…")
        });
        Self {
            evaluation: EvaluationScene::new(10_000),
            status,
            connection_hint,
            workspace: WorkspaceState::default(),
            composer,
            _load_task: load_task,
        }
    }
}

impl Render for NativeWorkbench {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let projects = self.workspace.projects.iter().map(|project| {
            let count = self
                .workspace
                .conversations
                .iter()
                .filter(|conversation| conversation.project_id == project.id)
                .count();
            div().mt(px(8.0)).child(project.name.clone()).child(
                div()
                    .text_xs()
                    .text_color(theme::MUTED)
                    .child(format!("{count} conversations · {}", project.dir)),
            )
        });
        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(theme::BACKGROUND)
            .text_color(theme::TEXT)
            .child(
                div()
                    .h(px(48.0))
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(16.0))
                    .border_b_1()
                    .border_color(theme::BORDER)
                    .child(div().font_weight(gpui::FontWeight::SEMIBOLD).child("Nerve"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::MUTED)
                            .child(self.status.clone()),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .flex()
                    .overflow_hidden()
                    .child(
                        div()
                            .w(px(250.0))
                            .h_full()
                            .border_r_1()
                            .border_color(theme::BORDER)
                            .bg(theme::PANEL)
                            .p(px(12.0))
                            .child(div().text_sm().text_color(theme::MUTED).child("PROJECTS"))
                            .children(projects)
                            .when(self.workspace.projects.is_empty(), |panel| {
                                panel
                                    .child(div().mt(px(12.0)).child("Native UI evaluation"))
                                    .child(
                                        div()
                                            .mt(px(8.0))
                                            .text_color(theme::ACCENT)
                                            .child("10,000-row transcript"),
                                    )
                            })
                            .child(
                                div()
                                    .mt(px(12.0))
                                    .text_xs()
                                    .text_color(theme::MUTED)
                                    .child(self.connection_hint.clone()),
                            ),
                    )
                    .child(
                        self.evaluation
                            .render_with_composer(Input::new(&self.composer)),
                    ),
            )
    }
}
