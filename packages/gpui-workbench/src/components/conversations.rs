use std::rc::Rc;

use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use gpui_component::{ActiveTheme, Icon, IconName, h_flex, scroll::ScrollableElement};

use crate::workbench::{ConnectionStatus, ConversationSection};

use super::callbacks::StringCallback;

#[derive(IntoElement)]
pub struct ConversationList {
    status: ConnectionStatus,
    has_project: bool,
    sections: Vec<ConversationSection>,
    selected_id: Option<String>,
    on_select: Option<StringCallback>,
}

impl ConversationList {
    pub fn new(
        status: ConnectionStatus,
        has_project: bool,
        sections: Vec<ConversationSection>,
    ) -> Self {
        Self {
            status,
            has_project,
            sections,
            selected_id: None,
            on_select: None,
        }
    }

    pub fn selected(mut self, id: Option<String>) -> Self {
        self.selected_id = id;
        self
    }

    pub fn on_select(mut self, handler: impl Fn(&String, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ConversationList {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        if !self.has_project {
            let (title, detail) = match &self.status {
                ConnectionStatus::Connecting => (
                    "Loading projects",
                    "Connecting to the existing Workbench server…".to_string(),
                ),
                ConnectionStatus::Retrying(message) => ("Reconnecting", message.clone()),
                ConnectionStatus::Error(message) => ("Could not connect", message.clone()),
                ConnectionStatus::Closed => (
                    "No project selected",
                    "Start the Workbench server, then reopen this client.".to_string(),
                ),
                ConnectionStatus::Live => (
                    "No projects",
                    "Open a project in Nerve to see its conversations here.".to_string(),
                ),
            };
            return empty_state(title, detail, cx).into_any_element();
        }

        if self.sections.is_empty() {
            return empty_state(
                "No conversations yet",
                "Conversations are scoped to the selected project.".to_string(),
                cx,
            )
            .into_any_element();
        }

        let selected_id = self.selected_id;
        let on_select = self.on_select;
        let foreground = cx.theme().foreground;
        let muted_foreground = cx.theme().muted_foreground;
        let selection = cx.theme().selection;
        let list = cx.theme().list;
        let list_hover = cx.theme().list_hover;
        let radius = cx.theme().radius;
        div()
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_y_scrollbar()
            .pb_2()
            .children(self.sections.into_iter().map(|section| {
                let count = section.rows.len();
                let selected_id = selected_id.clone();
                let on_select = on_select.clone();
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .child(
                        h_flex()
                            .h(px(28.))
                            .flex_none()
                            .items_center()
                            .justify_between()
                            .px_3()
                            .text_xs()
                            .text_color(muted_foreground)
                            .child(section.kind.label())
                            .child(count.to_string()),
                    )
                    .children(section.rows.into_iter().map(move |conversation| {
                        let id = conversation.id.clone();
                        let handler_id = id.clone();
                        let selected = selected_id.as_deref() == Some(id.as_str());
                        let on_select = on_select.clone();
                        let row_background = if selected { selection } else { list };
                        let timestamp = crate::workbench::compact_timestamp(conversation.sort_at());
                        div()
                            .id(SharedString::from(format!("conversation-{id}")))
                            .debug_selector(move || format!("conversation-{id}"))
                            .mx_1()
                            .mb_1()
                            .min_h(px(44.))
                            .flex()
                            .items_center()
                            .gap_2()
                            .px_2()
                            .py_1()
                            .rounded(radius)
                            .bg(row_background)
                            .cursor_pointer()
                            .hover(move |style| style.bg(list_hover))
                            .on_click(move |_, window, cx| {
                                if let Some(on_select) = &on_select {
                                    on_select(&handler_id, window, cx);
                                }
                            })
                            .child(
                                Icon::new(if conversation.pinned {
                                    IconName::Star
                                } else {
                                    IconName::Bot
                                })
                                .size(px(14.))
                                .text_color(muted_foreground),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .w_full()
                                            .overflow_hidden()
                                            .whitespace_nowrap()
                                            .text_ellipsis()
                                            .text_sm()
                                            .text_color(foreground)
                                            .child(conversation.title),
                                    )
                                    .child(
                                        h_flex()
                                            .items_center()
                                            .gap_2()
                                            .text_xs()
                                            .text_color(muted_foreground)
                                            .child(timestamp)
                                            .when(conversation.completed_at.is_some(), |this| {
                                                this.child("Completed")
                                            }),
                                    ),
                            )
                    }))
            }))
            .into_any_element()
    }
}

fn empty_state(title: &'static str, detail: String, cx: &mut App) -> impl IntoElement + use<> {
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_2()
        .px_4()
        .text_center()
        .child(
            Icon::new(IconName::Bot)
                .size(px(20.))
                .text_color(cx.theme().muted_foreground),
        )
        .child(
            div()
                .text_sm()
                .text_color(cx.theme().foreground)
                .child(title),
        )
        .child(
            div()
                .max_w(px(260.))
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(detail),
        )
}
