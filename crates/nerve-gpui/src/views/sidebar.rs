use gpui::{AnyElement, div, prelude::*};

use crate::{components::status_dot, theme::Theme, view_model::ConversationRow};

pub fn sidebar_frame(count: usize, theme: Theme) -> gpui::Div {
    div()
        .h_full()
        .w_72()
        .flex_none()
        .flex()
        .flex_col()
        .border_r_1()
        .border_color(theme.border)
        .bg(theme.sidebar)
        .child(
            div()
                .h_10()
                .px_3()
                .flex_none()
                .flex()
                .items_center()
                .justify_between()
                .border_b_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_sm()
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(theme.sidebar_foreground)
                        .child("Conversations"),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(count.to_string()),
                ),
        )
}

pub fn project_row(name: &str, theme: Theme) -> AnyElement {
    div()
        .h_8()
        .px_3()
        .pt_2()
        .flex()
        .items_center()
        .text_xs()
        .font_weight(gpui::FontWeight::MEDIUM)
        .text_color(theme.muted_foreground)
        .child(name.to_owned())
        .into_any_element()
}

pub fn conversation_row(
    row: &ConversationRow,
    index: usize,
    theme: Theme,
) -> gpui::Stateful<gpui::Div> {
    div()
        .id(("conversation", index))
        .h_9()
        .mx_1()
        .px_2()
        .flex()
        .items_center()
        .gap_2()
        .rounded_md()
        .cursor_pointer()
        .text_sm()
        .text_color(if row.is_selected {
            theme.sidebar_accent_foreground
        } else {
            theme.muted_foreground
        })
        .when(row.is_selected, |item| item.bg(theme.sidebar_accent))
        .hover(|item| item.bg(theme.sidebar_accent))
        .child(status_dot(
            if row.is_active {
                theme.info
            } else {
                theme.muted_foreground
            },
            row.is_active,
        ))
        .child(div().min_w_0().truncate().child(row.title.clone()))
}
