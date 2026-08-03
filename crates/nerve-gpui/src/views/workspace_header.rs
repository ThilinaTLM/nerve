use gpui::{AnyElement, div, prelude::*};

use crate::{
    components::{badge, status_dot},
    theme::{HEADER_HEIGHT, Theme},
    view_model::connection_label,
};
use nerve_client::ConnectionState;

pub fn workspace_header(
    project_name: Option<&str>,
    connection: Option<ConnectionState>,
    theme: Theme,
) -> AnyElement {
    let (label, live) = connection_label(connection);
    let status_color = if live { theme.success } else { theme.warning };
    div()
        .h(gpui::px(HEADER_HEIGHT))
        .flex_none()
        .px_4()
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(theme.border)
        .bg(theme.card)
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .size_7()
                        .rounded_md()
                        .bg(theme.primary)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme.primary_foreground)
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .child("N"),
                )
                .child(
                    div()
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(theme.card_foreground)
                        .child("Nerve"),
                )
                .child(div().w_px().h_5().bg(theme.border))
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.muted_foreground)
                        .child(project_name.unwrap_or("Local workspace").to_owned()),
                )
                .child(badge("Experimental", theme)),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(status_dot(status_color, live))
                .child(label),
        )
        .into_any_element()
}
