mod icon;

pub use icon::{Icon, IconName};

use gpui::{AnyElement, Hsla, div, prelude::*};

use crate::theme::Theme;

pub fn badge(label: impl Into<String>, theme: Theme) -> AnyElement {
    div()
        .px_2()
        .h_6()
        .flex()
        .items_center()
        .rounded_md()
        .border_1()
        .border_color(theme.border)
        .bg(theme.muted.opacity(0.55))
        .text_xs()
        .text_color(theme.muted_foreground)
        .child(label.into())
        .into_any_element()
}

pub fn status_dot(color: Hsla, filled: bool) -> AnyElement {
    div()
        .size_2()
        .flex_none()
        .rounded_full()
        .when(filled, |dot| dot.bg(color))
        .when(!filled, |dot| dot.border_1().border_color(color))
        .into_any_element()
}

pub fn empty_state(
    title: impl Into<String>,
    detail: impl Into<String>,
    theme: Theme,
) -> AnyElement {
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_2()
        .px_6()
        .text_center()
        .child(
            div()
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(theme.foreground)
                .child(title.into()),
        )
        .child(
            div()
                .max_w_96()
                .text_sm()
                .text_color(theme.muted_foreground)
                .child(detail.into()),
        )
        .into_any_element()
}
