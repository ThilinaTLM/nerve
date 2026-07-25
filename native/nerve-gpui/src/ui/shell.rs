use std::sync::Arc;

use gpui::{
    AnyElement, Context, Entity, IntoElement, ListAlignment, ListState, Render, SharedString,
    StatefulInteractiveElement, Subscription, Task, Window, div, list, prelude::*, px,
};
use gpui_component::input::{Input, InputEvent, InputState};

use super::theme;
use crate::{
    Options,
    daemon::DaemonConnection,
    evaluation::EvaluationScene,
    protocol::client::{ProtocolCommand, ProtocolEvent, ProtocolHandle},
    state::{
        conversation::{ConversationState, LiveBlockKind},
        workspace::WorkspaceState,
    },
};

#[derive(Clone)]
struct TranscriptRow {
    key: String,
    label: String,
    text: String,
    tone: gpui::Rgba,
}

pub(crate) struct NativeWorkbench {
    evaluation_mode: bool,
    evaluation: EvaluationScene,
    status: String,
    connection_hint: String,
    workspace: WorkspaceState,
    conversation: Option<ConversationState>,
    selected_project_id: Option<String>,
    selected_conversation_id: Option<String>,
    draft_project_id: Option<String>,
    optimistic_prompts: Vec<(String, String)>,
    prompt_pending: bool,
    clear_composer: bool,
    composer: Entity<InputState>,
    transcript_state: ListState,
    protocol: Option<ProtocolHandle>,
    _subscriptions: Vec<Subscription>,
    _event_task: Option<Task<()>>,
}

impl NativeWorkbench {
    pub(crate) fn new(options: &Options, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let composer = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .placeholder("Ask Nerve about this project…")
        });
        let submit_subscription = cx.subscribe_in(
            &composer,
            window,
            |this, _, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::PressEnter { secondary: true }) {
                    this.submit_prompt(window, cx);
                }
            },
        );

        let mut protocol = None;
        let mut event_task = None;
        let (status, connection_hint) = if options.evaluation {
            (
                "Deterministic evaluation mode · no daemon mutations".to_owned(),
                "offline".to_owned(),
            )
        } else {
            match DaemonConnection::resolve(options).and_then(|connection| {
                connection.authorization_headers()?;
                let hint = connection.websocket_url.to_string();
                let handle = ProtocolHandle::start(connection);
                let receiver = handle.events();
                event_task = Some(cx.spawn(async move |this, cx| {
                    while let Ok(event) = receiver.recv().await {
                        let Some(this) = this.upgrade() else {
                            break;
                        };
                        if this
                            .update(cx, |workbench, cx| {
                                workbench.apply_protocol_event(event);
                                cx.notify();
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                }));
                protocol = Some(handle);
                Ok(("Connecting to Nerve daemon…".to_owned(), hint))
            }) {
                Ok(result) => result,
                Err(error) => (
                    format!("Daemon unavailable · {error}"),
                    "offline".to_owned(),
                ),
            }
        };

        Self {
            evaluation_mode: options.evaluation,
            evaluation: EvaluationScene::new(10_000),
            status,
            connection_hint,
            workspace: WorkspaceState::default(),
            conversation: None,
            selected_project_id: None,
            selected_conversation_id: None,
            draft_project_id: None,
            optimistic_prompts: Vec::new(),
            prompt_pending: false,
            clear_composer: false,
            composer,
            transcript_state: ListState::new(0, ListAlignment::Top, px(500.0)),
            protocol,
            _subscriptions: vec![submit_subscription],
            _event_task: event_task,
        }
    }

    fn apply_protocol_event(&mut self, event: ProtocolEvent) {
        match event {
            ProtocolEvent::Connecting => self.status = "Connecting to Nerve daemon…".into(),
            ProtocolEvent::Connected => self.status = "Connected".into(),
            ProtocolEvent::Disconnected(error) => {
                self.status = format!("Disconnected · {error}");
                self.prompt_pending = false;
            }
            ProtocolEvent::Workspace(workspace) => {
                if self.selected_project_id.is_none() {
                    self.selected_project_id =
                        workspace.projects.first().map(|value| value.id.clone());
                }
                self.workspace = workspace;
            }
            ProtocolEvent::Conversation(conversation) => {
                if self.selected_conversation_id.as_deref() != Some(conversation.id.as_str()) {
                    return;
                }
                for entry in &conversation.entries {
                    if entry.role == "user"
                        && let Some(index) = self
                            .optimistic_prompts
                            .iter()
                            .position(|(_, text)| text == &entry.text)
                    {
                        self.optimistic_prompts.remove(index);
                    }
                }
                self.conversation = Some(conversation);
                self.sync_transcript_count();
            }
            ProtocolEvent::ConversationCreated { conversation_id } => {
                self.selected_conversation_id = Some(conversation_id);
                self.draft_project_id = None;
            }
            ProtocolEvent::PromptAccepted => {
                self.prompt_pending = false;
                self.clear_composer = true;
            }
            ProtocolEvent::Error(error) => {
                self.status = format!("Action failed · {error}");
                self.prompt_pending = false;
            }
        }
    }

    fn sync_transcript_count(&self) {
        self.transcript_state.reset(self.transcript_rows().len());
    }

    fn begin_draft(&mut self, project_id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_project_id = Some(project_id.clone());
        self.selected_conversation_id = None;
        self.draft_project_id = Some(project_id);
        self.conversation = None;
        self.optimistic_prompts.clear();
        self.prompt_pending = false;
        self.transcript_state.reset(0);
        self.composer.update(cx, |input, cx| {
            input.set_value("", window, cx);
            input.focus(window, cx);
        });
        cx.notify();
    }

    fn select_conversation(
        &mut self,
        project_id: String,
        conversation_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selected_project_id = Some(project_id);
        self.selected_conversation_id = Some(conversation_id.clone());
        self.draft_project_id = None;
        self.conversation = None;
        self.optimistic_prompts.clear();
        self.prompt_pending = false;
        self.status = "Loading conversation…".into();
        self.transcript_state.reset(0);
        if let Some(protocol) = &self.protocol
            && let Err(error) = protocol.send(ProtocolCommand::SelectConversation(conversation_id))
        {
            self.status = format!("Action failed · {error}");
        }
        self.composer
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    fn submit_prompt(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.prompt_pending
            || self
                .conversation
                .as_ref()
                .is_some_and(|value| value.running)
        {
            return;
        }
        let text = self.composer.read(cx).value().trim().to_owned();
        if text.is_empty() {
            return;
        }
        let Some(protocol) = &self.protocol else {
            self.status = "Connect to a daemon before sending".into();
            cx.notify();
            return;
        };
        let command = if let Some(project_id) = &self.draft_project_id {
            ProtocolCommand::StartDraft {
                project_id: project_id.clone(),
                text: text.clone(),
            }
        } else if self.selected_conversation_id.is_some() {
            ProtocolCommand::SendPrompt { text: text.clone() }
        } else {
            self.status = "Choose a project’s + button or select a conversation".into();
            cx.notify();
            return;
        };
        match protocol.send(command) {
            Ok(()) => {
                self.prompt_pending = true;
                if !self
                    .optimistic_prompts
                    .iter()
                    .any(|(_, pending)| pending == &text)
                {
                    self.optimistic_prompts
                        .push((format!("optimistic_{}", uuid::Uuid::new_v4()), text));
                }
                self.sync_transcript_count();
                self.status = "Sending prompt…".into();
            }
            Err(error) => self.status = format!("Action failed · {error}"),
        }
        // Text is cleared only after the background worker confirms the run. Keeping
        // it here makes a failed first-send retry safe.
        self.composer
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    fn transcript_rows(&self) -> Vec<TranscriptRow> {
        let mut rows = Vec::new();
        if let Some(conversation) = &self.conversation {
            rows.extend(conversation.entries.iter().map(|entry| {
                let (label, tone) = match entry.role.as_str() {
                    "user" => ("YOU", theme::ACCENT),
                    "system" => ("SYSTEM", theme::MUTED),
                    _ => ("NERVE", theme::TEXT),
                };
                TranscriptRow {
                    key: entry.id.clone(),
                    label: label.into(),
                    text: entry.text.clone(),
                    tone,
                }
            }));
            rows.extend(
                conversation
                    .live_blocks
                    .iter()
                    .filter(|block| !block.text.is_empty())
                    .map(|block| {
                        let (label, tone) = match block.kind {
                            LiveBlockKind::Text => ("NERVE", theme::TEXT),
                            LiveBlockKind::Thinking => ("THINKING", theme::MUTED),
                        };
                        TranscriptRow {
                            key: block.content_block_id.clone(),
                            label: label.into(),
                            text: block.text.clone(),
                            tone,
                        }
                    }),
            );
        }
        rows.extend(
            self.optimistic_prompts
                .iter()
                .map(|(id, text)| TranscriptRow {
                    key: id.clone(),
                    label: "YOU".into(),
                    text: text.clone(),
                    tone: theme::ACCENT,
                }),
        );
        rows
    }

    #[allow(
        clippy::too_many_lines,
        reason = "the initial native vertical slice keeps its closely related GPUI tree together"
    )]
    fn render_daemon(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let projects = self.workspace.projects.clone();
        let workspace = self.workspace.clone();
        let selected_id = self.selected_conversation_id.clone();
        let draft_project_id = self.draft_project_id.clone();
        let navigator = div()
            .id("project-navigator")
            .w(px(290.0))
            .h_full()
            .overflow_y_scroll()
            .border_r_1()
            .border_color(theme::BORDER)
            .bg(theme::PANEL)
            .p(px(8.0))
            .children(projects.into_iter().map(|project| {
                let project_id = project.id.clone();
                let plus_project_id = project.id.clone();
                let count = workspace.conversations_for_project(&project.id).count();
                let conversations = workspace
                    .conversations_for_project(&project.id)
                    .cloned()
                    .collect::<Vec<_>>();
                div()
                    .id(SharedString::from(format!("project-{}", project.id)))
                    .mb(px(10.0))
                    .rounded_md()
                    .border_1()
                    .border_color(theme::BORDER)
                    .child(
                        div()
                            .h(px(38.0))
                            .flex()
                            .items_center()
                            .justify_between()
                            .px(px(10.0))
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .child(project.name),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(10.0))
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::MUTED)
                                            .child(count.to_string()),
                                    )
                                    .child(
                                        div()
                                            .id(SharedString::from(format!("new-{project_id}")))
                                            .cursor_pointer()
                                            .text_color(theme::TEXT)
                                            .child("+")
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                this.begin_draft(
                                                    plus_project_id.clone(),
                                                    window,
                                                    cx,
                                                );
                                            })),
                                    ),
                            ),
                    )
                    .when(
                        draft_project_id.as_deref() == Some(project.id.as_str()),
                        |panel| {
                            panel.child(
                                div()
                                    .mx(px(5.0))
                                    .mb(px(3.0))
                                    .px(px(8.0))
                                    .py(px(7.0))
                                    .rounded_md()
                                    .bg(theme::SELECTED)
                                    .text_sm()
                                    .child("New Conversation"),
                            )
                        },
                    )
                    .children(conversations.into_iter().map(|conversation| {
                        let conversation_id = conversation.id.clone();
                        let row_project_id = conversation.project_id.clone();
                        let selected = selected_id.as_deref() == Some(conversation.id.as_str());
                        div()
                            .id(SharedString::from(format!(
                                "conversation-{}",
                                conversation.id
                            )))
                            .mx(px(5.0))
                            .mb(px(3.0))
                            .px(px(8.0))
                            .py(px(7.0))
                            .rounded_md()
                            .cursor_pointer()
                            .when(selected, |row| row.bg(theme::SELECTED))
                            .text_sm()
                            .text_color(if selected { theme::TEXT } else { theme::MUTED })
                            .overflow_hidden()
                            .child(conversation.title)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.select_conversation(
                                    row_project_id.clone(),
                                    conversation_id.clone(),
                                    window,
                                    cx,
                                );
                            }))
                    }))
            }));

        let rows = Arc::new(self.transcript_rows());
        if self.transcript_state.item_count() != rows.len() {
            self.transcript_state.reset(rows.len());
        }
        let render_rows = Arc::clone(&rows);
        let transcript = list(self.transcript_state.clone(), move |index, _, _| {
            let row = &render_rows[index];
            div()
                .id(SharedString::from(row.key.clone()))
                .mx(px(18.0))
                .my(px(5.0))
                .p(px(12.0))
                .rounded_md()
                .bg(theme::PANEL)
                .border_1()
                .border_color(theme::BORDER)
                .child(
                    div()
                        .text_xs()
                        .text_color(row.tone)
                        .child(row.label.clone()),
                )
                .child(
                    div()
                        .mt(px(6.0))
                        .text_sm()
                        .line_height(gpui::relative(1.45))
                        .child(row.text.clone()),
                )
                .into_any_element()
        });

        let title = if self.draft_project_id.is_some() {
            "New Conversation".to_owned()
        } else if let Some(conversation) = &self.conversation {
            conversation.title.clone()
        } else if self.selected_conversation_id.is_some() {
            "Loading conversation…".to_owned()
        } else {
            "Select a conversation".to_owned()
        };
        let can_send = !self.prompt_pending
            && self.protocol.is_some()
            && (self.draft_project_id.is_some() || self.selected_conversation_id.is_some())
            && !self
                .conversation
                .as_ref()
                .is_some_and(|value| value.running);
        let send_label = if self.prompt_pending {
            "Sending…"
        } else if self
            .conversation
            .as_ref()
            .is_some_and(|value| value.running)
        {
            "Running"
        } else {
            "Send"
        };

        let center =
            div()
                .flex_1()
                .h_full()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(52.0))
                        .flex()
                        .items_center()
                        .justify_between()
                        .px(px(18.0))
                        .border_b_1()
                        .border_color(theme::BORDER)
                        .child(div().font_weight(gpui::FontWeight::SEMIBOLD).child(title))
                        .child(
                            div().text_xs().text_color(theme::MUTED).child(
                                self.conversation
                                    .as_ref()
                                    .and_then(|value| value.run_status.clone())
                                    .unwrap_or_default(),
                            ),
                        ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .when(rows.is_empty(), |panel| {
                            panel.child(div().p(px(24.0)).text_color(theme::MUTED).child(
                                if self.draft_project_id.is_some() {
                                    "Send a prompt to create this conversation."
                                } else {
                                    "Choose a conversation from the project navigator."
                                },
                            ))
                        })
                        .when(!rows.is_empty(), |panel| panel.child(transcript)),
                )
                .child(
                    div()
                        .m(px(12.0))
                        .mt(px(6.0))
                        .h(px(92.0))
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        .rounded_md()
                        .border_1()
                        .border_color(if can_send {
                            theme::ACCENT
                        } else {
                            theme::BORDER
                        })
                        .bg(theme::PANEL)
                        .p(px(12.0))
                        .child(div().flex_1().h_full().child(Input::new(&self.composer)))
                        .child(
                            div()
                                .id("send-prompt")
                                .px(px(14.0))
                                .py(px(9.0))
                                .rounded_md()
                                .bg(if can_send {
                                    theme::ACCENT
                                } else {
                                    theme::BORDER
                                })
                                .text_color(theme::TEXT)
                                .text_sm()
                                .when(can_send, |button| {
                                    button.cursor_pointer().on_click(cx.listener(
                                        |this, _, window, cx| this.submit_prompt(window, cx),
                                    ))
                                })
                                .child(send_label),
                        ),
                );

        div()
            .flex_1()
            .h_full()
            .flex()
            .overflow_hidden()
            .child(navigator)
            .child(center)
            .into_any_element()
    }
}

impl Render for NativeWorkbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.clear_composer {
            self.clear_composer = false;
            self.composer
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        let body = if self.evaluation_mode {
            self.evaluation
                .render_with_composer(Input::new(&self.composer))
        } else {
            div()
                .flex_1()
                .flex()
                .overflow_hidden()
                .child(self.render_daemon(cx))
                .into_any_element()
        };
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
            .child(body)
            .child(
                div()
                    .h(px(22.0))
                    .px(px(10.0))
                    .text_xs()
                    .text_color(theme::MUTED)
                    .child(self.connection_hint.clone()),
            )
    }
}
