use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use gpui_component::{ActiveTheme, Icon, IconName};

/// A centered icon + label placeholder used for empty panes and for panels
/// that don't have real content yet (e.g. the side panel bodies and the
/// editor content area).
#[derive(IntoElement)]
pub struct Placeholder {
    icon: IconName,
    label: SharedString,
    background: bool,
}

impl Placeholder {
    pub fn new(icon: IconName, label: impl Into<SharedString>) -> Self {
        Self {
            icon,
            label: label.into(),
            background: false,
        }
    }

    /// Fill the region with the muted background color. Used in the editor
    /// content area, where the tab bar sits above a muted surface.
    pub fn with_background(mut self) -> Self {
        self.background = true;
        self
    }
}

impl RenderOnce for Placeholder {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .overflow_hidden()
            .when(self.background, |this| this.bg(cx.theme().muted))
            .text_color(cx.theme().muted_foreground)
            .text_sm()
            .child(
                Icon::new(self.icon)
                    .size(px(24.))
                    .text_color(cx.theme().muted_foreground),
            )
            .child(div().child(self.label))
    }
}
