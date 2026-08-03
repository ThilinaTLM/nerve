use gpui::{div, prelude::*};

use crate::theme::{Theme, UI_FONT};

pub fn shell(theme: Theme) -> gpui::Div {
    div()
        .size_full()
        .flex()
        .flex_col()
        .overflow_hidden()
        .font_family(UI_FONT)
        .bg(theme.background)
        .text_color(theme.foreground)
}
