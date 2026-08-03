use gpui::{AnyElement, ListState, div, list, prelude::*};

use crate::{components::empty_state, theme::Theme, view_model::TranscriptRow};

pub fn transcript(
    entries: Vec<TranscriptRow>,
    list_state: ListState,
    has_selection: bool,
    loading: bool,
    theme: Theme,
) -> AnyElement {
    if loading {
        return empty_state(
            "Loading conversation",
            "Fetching the latest transcript snapshot…",
            theme,
        );
    }
    if entries.is_empty() {
        return if has_selection {
            empty_state(
                "No transcript entries",
                "This conversation does not contain any visible messages yet.",
                theme,
            )
        } else {
            empty_state(
                "Select a conversation",
                "Choose a conversation from the left dock to inspect its read-only transcript.",
                theme,
            )
        };
    }
    div()
        .id("transcript")
        .size_full()
        .child(
            list(list_state, move |index, _window, _cx| {
                div()
                    .w_full()
                    .max_w(gpui::px(880.0))
                    .mx_auto()
                    .px_8()
                    .py_3()
                    .child(entry_row(&entries[index], theme))
                    .into_any_element()
            })
            .size_full(),
        )
        .into_any_element()
}

fn entry_row(entry: &TranscriptRow, theme: Theme) -> AnyElement {
    let is_user = entry.role == "user";
    let is_system = entry.role == "system";
    let label_color = if is_user {
        theme.primary
    } else if is_system {
        theme.warning
    } else {
        theme.muted_foreground
    };
    let surface = if is_user {
        theme
            .primary
            .opacity(if theme.is_dark { 0.10 } else { 0.07 })
    } else {
        theme.card
    };
    div()
        .id(gpui::SharedString::from(entry.id.clone()))
        .w_full()
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .px_1()
                .flex()
                .items_center()
                .gap_2()
                .text_xs()
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(label_color)
                .child(entry.role.to_uppercase())
                .when(entry.kind != "message", |meta| {
                    meta.child(
                        div()
                            .text_color(theme.muted_foreground)
                            .child(entry.kind.clone()),
                    )
                }),
        )
        .child(
            div()
                .w_full()
                .p_4()
                .rounded_lg()
                .border_1()
                .border_color(theme.border)
                .bg(surface)
                .text_color(theme.foreground)
                .text_sm()
                .line_height(gpui::relative(1.55))
                .child(entry.text.clone()),
        )
        .into_any_element()
}
