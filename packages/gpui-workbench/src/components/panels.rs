use std::rc::Rc;

use gpui::{AnyElement, App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use gpui_component::{
    ActiveTheme, IconName, Sizable as _,
    button::{Button, ButtonVariants as _},
    h_flex,
    tab::{Tab, TabBar},
    tooltip::Tooltip,
};

use super::callbacks::IndexCallback;
use super::placeholder::Placeholder;

#[derive(Clone, Copy)]
pub enum Side {
    Left,
    Right,
}

/// Identifies which tab a side panel is showing, so the workspace can attach
/// state (counters, "add" behavior) to specific tabs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanelTabKind {
    Conversations,
    Files,
    Task,
    ScratchNotes,
    Git,
    PullRequest,
    Context,
}

/// An icon-only action shown at the right end of a tab header (e.g. "+").
#[derive(Clone)]
pub struct PanelAction {
    id: &'static str,
    icon: IconName,
    tooltip: &'static str,
}

impl PanelAction {
    pub fn new(id: &'static str, icon: IconName, tooltip: &'static str) -> Self {
        Self { id, icon, tooltip }
    }
}

/// One side panel tab: how it appears in the tab strip, the header title, the
/// muted counter next to it, and any icon-only header actions.
#[derive(Clone)]
pub struct PanelTab {
    pub icon: IconName,
    pub label: &'static str,
    pub kind: PanelTabKind,
    pub count: usize,
    pub action: Option<PanelAction>,
}

impl PanelTab {
    pub fn new(icon: IconName, label: &'static str, kind: PanelTabKind, count: usize) -> Self {
        Self {
            icon,
            label,
            kind,
            count,
            action: None,
        }
    }

    pub fn with_action(mut self, action: PanelAction) -> Self {
        self.action = Some(action);
        self
    }
}

/// A side panel: an icon tab strip, then a header line (title + muted counter
/// on the left, icon-only actions on the right) and a content area that grows
/// to the available height. The header deliberately has no separator line
/// below it.
#[derive(IntoElement)]
pub struct SidePanel {
    side: Side,
    tabs: Vec<PanelTab>,
    active: usize,
    on_click: Option<IndexCallback>,
    on_add: Option<IndexCallback>,
    body: Option<AnyElement>,
}

impl SidePanel {
    pub fn new(side: Side, tabs: Vec<PanelTab>) -> Self {
        Self {
            side,
            tabs,
            active: 0,
            on_click: None,
            on_add: None,
            body: None,
        }
    }

    pub fn selected(mut self, index: usize) -> Self {
        self.active = index;
        self
    }

    pub fn on_click(mut self, on_click: impl Fn(&usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(on_click));
        self
    }

    /// Handler for the header action of the active tab; receives the tab index.
    pub fn on_add(mut self, on_add: impl Fn(&usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_add = Some(Rc::new(on_add));
        self
    }

    pub fn body(mut self, body: impl IntoElement) -> Self {
        self.body = Some(body.into_any_element());
        self
    }
}

impl RenderOnce for SidePanel {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let active = self.active.min(self.tabs.len().saturating_sub(1));
        let active_tab = self
            .tabs
            .get(active)
            .cloned()
            .expect("side panel tabs are never empty");
        let tab_bar_id = match self.side {
            Side::Left => "left-panel-tabs",
            Side::Right => "right-panel-tabs",
        };
        let active_index = active;
        let on_add = self.on_add.clone();
        let body = self.body.unwrap_or_else(|| {
            Placeholder::new(active_tab.icon.clone(), active_tab.label).into_any_element()
        });

        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(cx.theme().tab_bar)
            .text_color(cx.theme().foreground)
            .child(
                TabBar::new(tab_bar_id)
                    .segmented()
                    // The segmented variant defaults to a darker strip
                    // (`tab_bar_segmented`); blend it with the panel so the
                    // tab header matches the surrounding side panel background.
                    .bg(cx.theme().tab_bar)
                    .children(self.tabs.iter().map(|tab| {
                        let label = tab.label;
                        Tab::default()
                            .icon(tab.icon.clone())
                            .tooltip(move |window, cx| Tooltip::new(label).build(window, cx))
                    }))
                    .selected_index(active)
                    .when_some(self.on_click.clone(), |this, on_click| {
                        this.on_click(move |ix, window, cx| on_click(ix, window, cx))
                    }),
            )
            // Header line: title + muted counter on the left, icon-only
            // actions on the right. No separator below it on purpose.
            .child(
                div()
                    .id("panel-header")
                    .debug_selector(|| "panel-header".to_string())
                    .h(px(32.))
                    .w_full()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_3()
                    .child(
                        h_flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(cx.theme().foreground)
                                    .child(active_tab.label),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(format!("({})", active_tab.count)),
                            ),
                    )
                    .when_some(active_tab.action, |this, action| {
                        let action_id = action.id;
                        this.child(
                            h_flex().items_center().gap_1().child(
                                div()
                                    .id(SharedString::from(format!("{action_id}-debug")))
                                    // Test hook: noop outside test builds.
                                    .debug_selector(move || format!("{action_id}-debug"))
                                    .child(
                                        Button::new(action.id)
                                            .icon(action.icon)
                                            .ghost()
                                            .small()
                                            .tooltip(action.tooltip)
                                            .when_some(on_add.clone(), |button, on_add| {
                                                button.on_click(move |_, window, cx| {
                                                    on_add(&active_index, window, cx)
                                                })
                                            }),
                                    ),
                            ),
                        )
                    }),
            )
            .child(body)
    }
}
