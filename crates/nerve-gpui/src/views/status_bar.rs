use gpui::{AnyElement, div, prelude::*};
use nerve_client::ConnectionState;

use crate::{
    components::{Icon, IconName, status_dot},
    theme::{MONO_FONT, STATUS_HEIGHT, Theme},
    view_model::connection_label,
};

pub fn status_bar(
    state: Option<ConnectionState>,
    project_dir: Option<&str>,
    theme: Theme,
) -> AnyElement {
    let (label, live) = connection_label(state);
    let color = if live { theme.success } else { theme.warning };
    div()
        .h(gpui::px(STATUS_HEIGHT))
        .px_3()
        .flex_none()
        .flex()
        .items_center()
        .justify_between()
        .border_t_1()
        .border_color(theme.border)
        .bg(theme.card)
        .text_xs()
        .text_color(theme.muted_foreground)
        .child(
            div()
                .min_w_0()
                .flex()
                .items_center()
                .gap_2()
                .child(Icon::new(IconName::ReadOnly, theme.muted_foreground).size(12.0))
                .child("Read-only GPUI preview")
                .when_some(project_dir, |row, dir| {
                    row.child(
                        div()
                            .ml_2()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .child(dir.to_owned()),
                    )
                }),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(status_dot(color, live))
                .child(label),
        )
        .into_any_element()
}
