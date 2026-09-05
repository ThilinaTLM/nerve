use std::rc::Rc;

use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use gpui_component::{
    ActiveTheme, Disableable as _, Icon, IconName, Sizable as _,
    button::{Button, ButtonVariants as _, Toggle},
    h_flex,
    menu::{DropdownMenu as _, PopupMenuItem},
    tooltip::Tooltip,
};

use crate::workbench::{ConnectionStatus, ProjectItem};

use super::callbacks::{ActionCallback, StringCallback};

pub(super) const HEADER_HEIGHT: gpui::Pixels = px(36.);
pub(super) const STATUS_BAR_HEIGHT: gpui::Pixels = px(24.);

#[derive(IntoElement)]
pub struct Header {
    projects: Vec<ProjectItem>,
    active_key: Option<String>,
    status: ConnectionStatus,
    on_select_project: Option<StringCallback>,
}

impl Header {
    pub fn new(
        projects: Vec<ProjectItem>,
        active_key: Option<String>,
        status: ConnectionStatus,
    ) -> Self {
        Self {
            projects,
            active_key,
            status,
            on_select_project: None,
        }
    }

    pub fn on_select_project(
        mut self,
        handler: impl Fn(&String, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_select_project = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Header {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let active_project = self
            .active_key
            .as_deref()
            .and_then(|key| self.projects.iter().find(|project| project.key == key));
        let trigger_label = active_project
            .map(|project| project.label.clone())
            .unwrap_or_else(|| match self.status {
                ConnectionStatus::Connecting | ConnectionStatus::Retrying(_) => {
                    "Loading projects…".to_string()
                }
                _ => "No projects".to_string(),
            });
        let disabled = self.projects.is_empty();
        let projects = self.projects;
        let active_key = self.active_key;
        let on_select = self.on_select_project;

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
            .child(
                Button::new("project-switcher")
                    .icon(IconName::FolderOpen)
                    .label(trigger_label)
                    .dropdown_caret(true)
                    .ghost()
                    .small()
                    .disabled(disabled)
                    .dropdown_menu(move |menu, _, _| {
                        projects.iter().fold(
                            menu.max_h(px(360.)).scrollable(true),
                            |menu, project| {
                                let key = project.key.clone();
                                let select_key = key.clone();
                                let label = project.label.clone();
                                let dir = project.dir.clone();
                                let count = project.conversation_count;
                                let checked = active_key.as_deref() == Some(key.as_str());
                                let on_select = on_select.clone();
                                menu.item(
                                    PopupMenuItem::element(move |_, cx| {
                                        h_flex()
                                            .min_w(px(260.))
                                            .max_w(px(420.))
                                            .items_center()
                                            .gap_3()
                                            .child(
                                                div()
                                                    .min_w_0()
                                                    .flex_1()
                                                    .flex()
                                                    .flex_col()
                                                    .child(
                                                        div()
                                                            .w_full()
                                                            .overflow_hidden()
                                                            .whitespace_nowrap()
                                                            .text_ellipsis()
                                                            .text_sm()
                                                            .text_color(cx.theme().foreground)
                                                            .child(label.clone()),
                                                    )
                                                    .child(
                                                        div()
                                                            .w_full()
                                                            .overflow_hidden()
                                                            .whitespace_nowrap()
                                                            .text_ellipsis()
                                                            .text_xs()
                                                            .text_color(cx.theme().muted_foreground)
                                                            .child(dir.clone()),
                                                    ),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(cx.theme().muted_foreground)
                                                    .child(count.to_string()),
                                            )
                                    })
                                    .checked(checked)
                                    .on_click(
                                        move |_, window, cx| {
                                            if let Some(on_select) = &on_select {
                                                on_select(&select_key, window, cx);
                                            }
                                        },
                                    ),
                                )
                            },
                        )
                    }),
            )
            .child(div().flex_1())
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
    connection_status: ConnectionStatus,
    connection_target: Option<String>,
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
            connection_status: ConnectionStatus::Closed,
            connection_target: None,
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

    pub fn connection(mut self, status: ConnectionStatus, target: Option<String>) -> Self {
        self.connection_status = status;
        self.connection_target = target;
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
        let connection_label = self.connection_status.label().to_string();
        let connection_detail = self
            .connection_status
            .detail()
            .map(ToOwned::to_owned)
            .or(self.connection_target);

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
            .child(
                h_flex()
                    .min_w_0()
                    .items_center()
                    .gap_2()
                    .child(div().child(connection_label))
                    .when_some(connection_detail, |this, detail| {
                        this.child(
                            div()
                                .max_w(px(360.))
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_color(cx.theme().muted_foreground)
                                .child(detail),
                        )
                    }),
            )
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
