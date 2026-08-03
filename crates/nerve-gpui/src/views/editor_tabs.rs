use gpui::{AnyElement, div, prelude::*};

use crate::{
    components::{Icon, IconName, status_dot},
    theme::{RAIL_HEIGHT, Theme},
};

pub fn editor_tabs(title: Option<&str>, is_active: bool, theme: Theme) -> AnyElement {
    div()
        .h(gpui::px(RAIL_HEIGHT))
        .flex_none()
        .flex()
        .items_center()
        .border_b_1()
        .border_color(theme.border)
        .bg(theme.card)
        .child(
            div()
                .h_full()
                .min_w_0()
                .max_w_96()
                .px_3()
                .flex()
                .items_center()
                .gap_2()
                .when(title.is_some(), |tab| {
                    tab.border_t_2()
                        .border_color(theme.primary)
                        .bg(theme.background)
                })
                .child(status_dot(
                    if is_active {
                        theme.info
                    } else {
                        theme.muted_foreground
                    },
                    is_active,
                ))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_xs()
                        .text_color(theme.foreground)
                        .child(title.unwrap_or("No conversation selected").to_owned()),
                ),
        )
        .child(div().flex_1())
        .child(
            div()
                .px_3()
                .flex()
                .items_center()
                .gap_1()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(Icon::new(IconName::ReadOnly, theme.muted_foreground).size(12.0))
                .child("Read only"),
        )
        .into_any_element()
}
