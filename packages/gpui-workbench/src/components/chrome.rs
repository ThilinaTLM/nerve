use std::rc::Rc;

use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use gpui_component::{
    ActiveTheme, Icon, IconName, Sizable as _, button::Toggle, h_flex, tooltip::Tooltip,
};

use super::callbacks::ActionCallback;

pub(super) const HEADER_HEIGHT: gpui::Pixels = px(36.);
pub(super) const STATUS_BAR_HEIGHT: gpui::Pixels = px(24.);

#[derive(IntoElement)]
pub struct Header;

impl RenderOnce for Header {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .h(HEADER_HEIGHT)
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .border_b_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().tab_bar)
            .text_sm()
            .text_color(cx.theme().foreground)
            .child(
                Icon::new(IconName::SquareTerminal)
                    .size(px(16.))
                    .text_color(cx.theme().primary),
            )
            .child("Nerve GPUI Workbench")
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("Experimental alpha"),
            )
    }
}

#[derive(IntoElement)]
pub struct StatusBar {
    left_visible: bool,
    right_visible: bool,
    bottom_visible: bool,
    is_mobile: bool,
    mobile_left_open: bool,
    mobile_right_open: bool,
    on_toggle_left: Option<ActionCallback>,
    on_toggle_right: Option<ActionCallback>,
    on_toggle_bottom: Option<ActionCallback>,
}

impl StatusBar {
    pub fn new() -> Self {
        Self {
            left_visible: true,
            right_visible: true,
            bottom_visible: true,
            is_mobile: false,
            mobile_left_open: false,
            mobile_right_open: false,
            on_toggle_left: None,
            on_toggle_right: None,
            on_toggle_bottom: None,
        }
    }

    pub fn left_visible(mut self, visible: bool) -> Self {
        self.left_visible = visible;
        self
    }

    pub fn right_visible(mut self, visible: bool) -> Self {
        self.right_visible = visible;
        self
    }

    pub fn bottom_visible(mut self, visible: bool) -> Self {
        self.bottom_visible = visible;
        self
    }

    pub fn mobile(mut self, is_mobile: bool) -> Self {
        self.is_mobile = is_mobile;
        self
    }

    pub fn mobile_left_open(mut self, open: bool) -> Self {
        self.mobile_left_open = open;
        self
    }

    pub fn mobile_right_open(mut self, open: bool) -> Self {
        self.mobile_right_open = open;
        self
    }

    pub fn on_toggle_left(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle_left = Some(Rc::new(handler));
        self
    }

    pub fn on_toggle_right(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle_right = Some(Rc::new(handler));
        self
    }

    pub fn on_toggle_bottom(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle_bottom = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for StatusBar {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let left_open = if self.is_mobile {
            self.mobile_left_open
        } else {
            self.left_visible
        };
        let right_open = if self.is_mobile {
            self.mobile_right_open
        } else {
            self.right_visible
        };
        let bottom_open = self.bottom_visible;

        div()
            .h(STATUS_BAR_HEIGHT)
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_2()
            .px_2()
            .border_t_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().tab_bar)
            .text_color(cx.theme().foreground)
            .text_xs()
            .child(h_flex().items_center().gap_1().child(toggle_button(
                "toggle-left-panel",
                left_open,
                IconName::PanelLeftClose,
                IconName::PanelLeftOpen,
                "Toggle Left Panel",
                self.on_toggle_left,
            )))
            .child(div().flex_1())
            .child(div().child("Disconnected prototype"))
            .child(
                h_flex()
                    .items_center()
                    .gap_1()
                    .child(toggle_button(
                        "toggle-bottom-panel",
                        bottom_open,
                        IconName::PanelBottom,
                        IconName::PanelBottomOpen,
                        "Toggle Bottom Panel",
                        self.on_toggle_bottom,
                    ))
                    .child(toggle_button(
                        "toggle-right-panel",
                        right_open,
                        IconName::PanelRightClose,
                        IconName::PanelRightOpen,
                        "Toggle Right Panel",
                        self.on_toggle_right,
                    )),
            )
    }
}

fn toggle_button(
    id: &'static str,
    open: bool,
    open_icon: IconName,
    closed_icon: IconName,
    tooltip: &'static str,
    on_click: Option<ActionCallback>,
) -> impl IntoElement {
    let icon = if open { open_icon } else { closed_icon };

    let mut toggle = Toggle::new(id).small().text_sm().icon(icon).checked(open);

    if let Some(on_click) = on_click {
        toggle = toggle.on_click(move |_, window, cx| (on_click)(window, cx));
    }

    // `tooltip` is only available on stateful elements in gpui 0.2, so give the
    // wrapper an id.
    div()
        .id(SharedString::from(format!("{id}-tooltip")))
        .child(toggle)
        .tooltip(move |window, cx| Tooltip::new(tooltip).build(window, cx))
}
