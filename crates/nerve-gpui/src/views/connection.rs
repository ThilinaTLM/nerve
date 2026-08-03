use gpui::{AnyElement, div, prelude::*};

use crate::theme::Theme;

pub fn error_banner(message: Option<&str>, theme: Theme) -> AnyElement {
    match message {
        Some(message) => div()
            .mx_3()
            .mt_3()
            .px_3()
            .py_2()
            .rounded_md()
            .border_1()
            .border_color(theme.destructive.opacity(0.45))
            .bg(theme.destructive.opacity(0.10))
            .text_color(theme.destructive)
            .text_sm()
            .child(message.to_owned())
            .into_any_element(),
        None => div().into_any_element(),
    }
}
