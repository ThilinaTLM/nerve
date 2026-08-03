use std::time::Duration;

use gpui::{
    AnyElement, Context, FocusHandle, Focusable, ListAlignment, ListState, Render, Subscription,
    Task, Window, div, prelude::*, px,
};
use nerve_client::{ClientEvent, ClientHandle, ConnectionConfig};

use crate::{
    state::WorkbenchState,
    theme::{Theme, ThemeMode},
    view_model::SidebarItem,
    views,
};

gpui::actions!(
    nerve_workbench,
    [
        ToggleSidebar,
        SelectPreviousConversation,
        SelectNextConversation
    ]
);

pub struct Workbench {
    state: WorkbenchState,
    client: ClientHandle,
    theme_mode: ThemeMode,
    focus_handle: FocusHandle,
    transcript_list: ListState,
    _appearance_subscription: Subscription,
    _poll_task: Task<()>,
}

impl Workbench {
    pub fn new(
        config: ConnectionConfig,
        theme_mode: ThemeMode,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let client = ClientHandle::start(config);
        let poll_task = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(50))
                    .await;
                if this
                    .update(cx, |workbench, cx| {
                        if workbench.drain_events() {
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let appearance_subscription =
            cx.observe_window_appearance(window, |_this, _window, cx| cx.notify());
        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle);
        Self {
            state: WorkbenchState::initial(),
            client,
            theme_mode,
            focus_handle,
            transcript_list: ListState::new(0, ListAlignment::Top, px(800.0)),
            _appearance_subscription: appearance_subscription,
            _poll_task: poll_task,
        }
    }

    fn drain_events(&mut self) -> bool {
        let mut changed = false;
        while let Some(event) = self.client.try_recv() {
            changed = true;
            match event {
                ClientEvent::Connection(state) => self.state.connection = Some(state),
                ClientEvent::Workspace(response) => {
                    self.state.projects = response.snapshot.projects;
                    self.state.conversations = response.snapshot.conversations;
                    self.state.loading_workspace = false;
                    self.state.error = None;
                }
                ClientEvent::Conversation(response) => {
                    self.state.selected_conversation_id = Some(response.snapshot.conversation.id);
                    self.state.entries = response.snapshot.entries;
                    self.transcript_list.reset(self.state.entries.len());
                    self.state.loading_conversation = false;
                    self.state.error = None;
                }
                ClientEvent::Error(message) => {
                    self.state.loading_workspace = false;
                    self.state.loading_conversation = false;
                    self.state.error = Some(message);
                }
            }
        }
        changed
    }

    fn select_conversation(&mut self, id: String, cx: &mut Context<Self>) {
        if self.state.selected_conversation_id.as_deref() == Some(id.as_str()) {
            return;
        }
        self.state.selected_conversation_id = Some(id.clone());
        self.state.entries.clear();
        self.transcript_list.reset(0);
        self.state.loading_conversation = true;
        self.state.error = None;
        self.client.select_conversation(Some(id));
        cx.notify();
    }

    fn select_relative(&mut self, offset: isize, cx: &mut Context<Self>) {
        if let Some(id) = self.state.select_relative(offset) {
            self.select_conversation(id, cx);
        }
    }

    fn render_sidebar(&self, theme: Theme, cx: &mut Context<Self>) -> AnyElement {
        let items = self.state.sidebar_items();
        let rows = items
            .into_iter()
            .enumerate()
            .map(|(index, item)| match item {
                SidebarItem::Project { name, .. } => views::sidebar::project_row(&name, theme),
                SidebarItem::Conversation(row) => {
                    let id = row.id.clone();
                    views::sidebar::conversation_row(&row, index, theme)
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.select_conversation(id.clone(), cx);
                        }))
                        .into_any_element()
                }
            });
        let list = if self.state.loading_workspace {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_sm()
                .text_color(theme.muted_foreground)
                .child("Loading workspace…")
                .into_any_element()
        } else if self.state.conversations.is_empty() {
            div()
                .flex_1()
                .px_4()
                .flex()
                .items_center()
                .justify_center()
                .text_center()
                .text_sm()
                .text_color(theme.muted_foreground)
                .child("No conversations in this workspace")
                .into_any_element()
        } else {
            div()
                .id("sidebar-list")
                .flex_1()
                .min_h_0()
                .overflow_scroll()
                .py_1()
                .children(rows)
                .into_any_element()
        };
        views::sidebar::sidebar_frame(self.state.conversations.len(), theme)
            .child(list)
            .into_any_element()
    }

    fn toggle_sidebar(&mut self, _: &ToggleSidebar, _: &mut Window, cx: &mut Context<Self>) {
        self.state.sidebar_visible = !self.state.sidebar_visible;
        cx.notify();
    }

    fn select_previous(
        &mut self,
        _: &SelectPreviousConversation,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.select_relative(-1, cx);
    }

    fn select_next(&mut self, _: &SelectNextConversation, _: &mut Window, cx: &mut Context<Self>) {
        self.select_relative(1, cx);
    }
}

impl Focusable for Workbench {
    fn focus_handle(&self, _cx: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = self.theme_mode.resolve(window.appearance());
        let project_name = self
            .state
            .selected_project()
            .map(|project| project.name.as_str())
            .or_else(|| {
                self.state
                    .projects
                    .first()
                    .map(|project| project.name.as_str())
            });
        let project_dir = self
            .state
            .selected_project()
            .map(|project| project.dir.as_str());
        let selected = self.state.selected_conversation();
        let selected_title = selected.map(|conversation| conversation.title.as_str());
        let selected_active =
            selected.is_some_and(|conversation| conversation.active_entry_id.is_some());
        let transcript_rows = self.state.transcript_rows();

        views::shell::shell(theme)
            .track_focus(&self.focus_handle)
            .key_context("NerveWorkbench")
            .on_action(cx.listener(Self::toggle_sidebar))
            .on_action(cx.listener(Self::select_previous))
            .on_action(cx.listener(Self::select_next))
            .child(views::workspace_header::workspace_header(
                project_name,
                self.state.connection,
                theme,
            ))
            .child(views::connection::error_banner(
                self.state.error.as_deref(),
                theme,
            ))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(
                        views::activity_rail::activity_rail(theme).on_click(cx.listener(
                            |this, _event, _window, cx| {
                                this.state.sidebar_visible = !this.state.sidebar_visible;
                                cx.notify();
                            },
                        )),
                    )
                    .when(self.state.sidebar_visible, |work| {
                        work.child(self.render_sidebar(theme, cx))
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .bg(theme.background)
                            .child(views::editor_tabs::editor_tabs(
                                selected_title,
                                selected_active,
                                theme,
                            ))
                            .child(
                                div()
                                    .flex_1()
                                    .min_h_0()
                                    .child(views::transcript::transcript(
                                        transcript_rows,
                                        self.transcript_list.clone(),
                                        selected.is_some(),
                                        self.state.loading_conversation,
                                        theme,
                                    )),
                            ),
                    )
                    .child(views::right_edge::right_edge(theme)),
            )
            .child(views::status_bar::status_bar(
                self.state.connection,
                project_dir,
                theme,
            ))
    }
}
