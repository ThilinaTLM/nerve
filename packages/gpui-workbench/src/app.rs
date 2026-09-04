use gpui::{
    App, Context, DefiniteLength, Entity, IntoElement, Pixels, Render, Window, div, prelude::*, px,
};
use gpui_component::{ActiveTheme, Placement, Root, WindowExt};

use crate::components::{Header, Side, SidePanel, StatusBar, WorkspaceLayout};

/// Below this width the layout switches to the mobile shell where the side
/// panels are hidden and become slide-in drawers opened from the status bar.
const MOBILE_BREAKPOINT: Pixels = px(768.);

pub struct AppShell {
    workspace: Entity<WorkspaceLayout>,
    left_visible: bool,
    right_visible: bool,
    bottom_visible: bool,
    is_mobile: bool,
    mobile_left_open: bool,
    mobile_right_open: bool,
}

impl AppShell {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            workspace: cx.new(|_| WorkspaceLayout::new()),
            left_visible: true,
            right_visible: true,
            bottom_visible: false,
            is_mobile: false,
            mobile_left_open: false,
            mobile_right_open: false,
        }
    }

    fn toggle_left(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_mobile {
            if self.mobile_left_open {
                window.close_sheet(cx);
                self.mobile_left_open = false;
                self.mobile_right_open = false;
            } else {
                if window.has_active_sheet(cx) {
                    window.close_sheet(cx);
                }
                self.mobile_left_open = true;
                self.mobile_right_open = false;
                self.open_drawer(Placement::Left, "Left Panel", Side::Left, window, cx);
            }
        } else {
            self.left_visible = !self.left_visible;
        }
        cx.notify();
    }

    fn toggle_right(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_mobile {
            if self.mobile_right_open {
                window.close_sheet(cx);
                self.mobile_left_open = false;
                self.mobile_right_open = false;
            } else {
                if window.has_active_sheet(cx) {
                    window.close_sheet(cx);
                }
                self.mobile_left_open = false;
                self.mobile_right_open = true;
                self.open_drawer(Placement::Right, "Right Panel", Side::Right, window, cx);
            }
        } else {
            self.right_visible = !self.right_visible;
        }
        cx.notify();
    }

    fn toggle_bottom(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        // The bottom panel stays inline on mobile; it never becomes a drawer.
        self.bottom_visible = !self.bottom_visible;
        cx.notify();
    }

    fn open_drawer(
        &mut self,
        placement: Placement,
        title: &'static str,
        side: Side,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let entity = cx.entity();
        let workspace = self.workspace.clone();
        window.open_sheet_at(placement, cx, move |sheet, _, app| {
            // The builder is re-invoked on every frame, so clone the handle into
            // the `on_close` closure (cloning keeps this builder an `Fn`).
            let close_entity = entity.clone();
            // Read the shared tab state fresh each frame so the drawer matches
            // the desktop side panel and keeps its selection across opens.
            let selected = workspace.read(app).tab_for(side);
            let tabs = workspace.read(app).panel_tabs(side);
            let on_tab = {
                let workspace = workspace.clone();
                move |ix: &usize, _: &mut Window, cx: &mut App| {
                    workspace.update(cx, |this, cx| {
                        this.set_tab(side, *ix);
                        cx.notify();
                    });
                }
            };
            let on_add = {
                let workspace = workspace.clone();
                move |ix: &usize, _: &mut Window, cx: &mut App| {
                    workspace.update(cx, |this, cx| this.panel_add(side, *ix, cx));
                }
            };
            sheet
                .title(title)
                .size(DefiniteLength::Fraction(0.8))
                .resizable(false)
                .overlay(true)
                .overlay_closable(true)
                .child(
                    SidePanel::new(side, tabs)
                        .selected(selected)
                        .on_click(on_tab)
                        .on_add(on_add),
                )
                .on_close(move |_, _, cx| {
                    // Covers overlay click, Escape and the title bar close button.
                    close_entity.update(cx, |this, cx| {
                        this.mobile_left_open = false;
                        this.mobile_right_open = false;
                        cx.notify();
                    });
                })
        });
    }
}

impl Render for AppShell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let is_mobile = window.bounds().size.width < MOBILE_BREAKPOINT;

        // Reconcile breakpoint transitions.
        if is_mobile != self.is_mobile {
            if !is_mobile {
                // Leaving mobile: close any open drawer so it does not linger
                // over the desktop layout.
                if window.has_active_sheet(cx) {
                    window.close_sheet(cx);
                }
                self.mobile_left_open = false;
                self.mobile_right_open = false;
            }
            self.is_mobile = is_mobile;
        }

        // Sync layout flags into the workspace entity (re-render only on change).
        let workspace = self.workspace.clone();
        let (left_visible, right_visible, bottom_visible) =
            (self.left_visible, self.right_visible, self.bottom_visible);
        workspace.update(cx, |this, cx| {
            let changed = this.left_visible != left_visible
                || this.right_visible != right_visible
                || this.bottom_visible != bottom_visible
                || this.is_mobile != is_mobile;
            this.left_visible = left_visible;
            this.right_visible = right_visible;
            this.bottom_visible = bottom_visible;
            this.is_mobile = is_mobile;
            if changed {
                cx.notify();
            }
        });

        // Status bar toggle handlers.
        let entity = cx.entity();
        let on_toggle_left = {
            let entity = entity.clone();
            move |window: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| this.toggle_left(window, cx));
            }
        };
        let on_toggle_right = {
            let entity = entity.clone();
            move |window: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| this.toggle_right(window, cx));
            }
        };
        let on_toggle_bottom = {
            let entity = entity.clone();
            move |window: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| this.toggle_bottom(window, cx));
            }
        };

        // Drawer/sheet overlay layer managed by the window Root.
        let sheet_layer = Root::render_sheet_layer(window, cx);

        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(Header)
            .child(
                div()
                    .w_full()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .overflow_hidden()
                    .child(self.workspace.clone()),
            )
            .child(
                StatusBar::new()
                    .left_visible(self.left_visible)
                    .right_visible(self.right_visible)
                    .bottom_visible(self.bottom_visible)
                    .mobile(self.is_mobile)
                    .mobile_left_open(self.mobile_left_open)
                    .mobile_right_open(self.mobile_right_open)
                    .on_toggle_left(on_toggle_left)
                    .on_toggle_right(on_toggle_right)
                    .on_toggle_bottom(on_toggle_bottom),
            )
            .children(sheet_layer)
    }
}
