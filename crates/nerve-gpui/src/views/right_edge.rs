use gpui::{AnyElement, div, prelude::*};

use crate::theme::Theme;

pub fn right_edge(theme: Theme) -> AnyElement {
    div()
        .w_2()
        .h_full()
        .flex_none()
        .border_l_1()
        .border_color(theme.border)
        .bg(theme.card)
        .into_any_element()
}
