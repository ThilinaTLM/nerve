use gpui::{div, prelude::*};

use crate::{
    components::{Icon, IconName},
    theme::Theme,
};

pub fn activity_rail(theme: Theme) -> gpui::Stateful<gpui::Div> {
    div()
        .id("activity-rail")
        .w_10()
        .h_full()
        .flex_none()
        .flex()
        .flex_col()
        .items_center()
        .border_r_1()
        .border_color(theme.border)
        .bg(theme.sidebar)
        .child(
            div()
                .id("activity-conversations")
                .w_full()
                .h_10()
                .flex()
                .items_center()
                .justify_center()
                .border_l_2()
                .border_color(theme.primary)
                .bg(theme.sidebar_accent)
                .child(Icon::new(IconName::Conversations, theme.sidebar_foreground)),
        )
}
