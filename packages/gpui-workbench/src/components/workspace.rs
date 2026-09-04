use std::rc::Rc;

use gpui::{
    App, Bounds, Context, IntoElement, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    Pixels, Point, Render, SharedString, Window, canvas, div, prelude::*, px,
};
use gpui_component::{ActiveTheme, IconName};

use super::callbacks::IndexCallback;
use super::center::ContentArea;
use super::panels::{PanelAction, PanelTab, PanelTabKind, Side, SidePanel};

const LEFT_INITIAL: Pixels = px(220.);
const LEFT_MIN: Pixels = px(140.);
const RIGHT_INITIAL: Pixels = px(240.);
const RIGHT_MIN: Pixels = px(160.);
const BOTTOM_INITIAL: Pixels = px(160.);
const BOTTOM_MIN: Pixels = px(100.);
const CENTER_MIN: Pixels = px(240.);
const CONTENT_MIN: Pixels = px(120.);
const HANDLE_SIZE: Pixels = px(5.);
const DIVIDER_SIZE: Pixels = px(1.);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResizeTarget {
    Left,
    Right,
    Bottom,
}

/// The axis along which a resize handle is dragged.
#[derive(Clone, Copy)]
enum HandleOrientation {
    Vertical,
    Horizontal,
}

/// Everything needed to render one side of the three-column layout.
struct SideColumn {
    side: Side,
    width: Pixels,
    handle_id: &'static str,
    target: ResizeTarget,
    selected: usize,
    on_click: IndexCallback,
}

pub struct WorkspaceLayout {
    left_width: Pixels,
    right_width: Pixels,
    bottom_height: Pixels,
    active_resize: Option<ResizeTarget>,
    bounds: Bounds<Pixels>,
    pub(crate) left_visible: bool,
    pub(crate) right_visible: bool,
    pub(crate) bottom_visible: bool,
    pub(crate) is_mobile: bool,
    /// Selected tab index per pane; kept here so both the desktop panels and
    /// the mobile drawers share the same state.
    left_tab: usize,
    right_tab: usize,
    /// Open files shown as tabs in the center column, like an editor tab strip.
    open_files: Vec<SharedString>,
    /// Index of the active file in [`Self::open_files`].
    content_tab: usize,
    /// Counter used to name files created from the "+" button.
    next_untitled: usize,
    /// Scratch notes created from the side panel "+" button; drives the
    /// counter shown in the Scratch Notes tab header.
    scratch_notes: Vec<SharedString>,
    /// Counter used to name new scratch notes.
    next_scratch_note: usize,
}

impl WorkspaceLayout {
    pub fn new() -> Self {
        Self {
            left_width: LEFT_INITIAL,
            right_width: RIGHT_INITIAL,
            bottom_height: BOTTOM_INITIAL,
            active_resize: None,
            bounds: Bounds::default(),
            left_visible: true,
            right_visible: true,
            bottom_visible: false,
            is_mobile: false,
            left_tab: 0,
            right_tab: 0,
            open_files: vec![
                "overview.md".into(),
                "src/main.rs".into(),
                "Cargo.toml".into(),
            ],
            content_tab: 0,
            next_untitled: 1,
            scratch_notes: vec!["Scratch note 1".into(), "Scratch note 2".into()],
            next_scratch_note: 3,
        }
    }

    /// The selected tab index for the given side panel.
    pub(crate) fn tab_for(&self, side: Side) -> usize {
        match side {
            Side::Left => self.left_tab,
            Side::Right => self.right_tab,
        }
    }

    /// Set the selected tab index for the given side panel.
    pub(crate) fn set_tab(&mut self, side: Side, index: usize) {
        match side {
            Side::Left => self.left_tab = index,
            Side::Right => self.right_tab = index,
        }
    }

    /// Open the given file, focusing it if already open. Pure state update;
    /// callers notify afterwards.
    fn select_file(&mut self, name: &SharedString) {
        match self.open_files.iter().position(|f| f == name) {
            Some(ix) => self.content_tab = ix,
            None => {
                self.open_files.push(name.clone());
                self.content_tab = self.open_files.len() - 1;
            }
        }
    }

    /// Close the file tab at `index`, keeping the selection on a sensible
    /// neighbor (VS Code style). Pure state update; callers notify afterwards.
    fn close_file_at(&mut self, index: usize) {
        if index >= self.open_files.len() {
            return;
        }
        self.open_files.remove(index);
        self.content_tab = if self.open_files.is_empty() {
            0
        } else if self.content_tab > index {
            self.content_tab - 1
        } else {
            self.content_tab.min(self.open_files.len() - 1)
        };
    }

    fn close_file(&mut self, index: usize, cx: &mut Context<Self>) {
        self.close_file_at(index);
        cx.notify();
    }

    /// Build the tabs for a side panel, filling in the live counters and the
    /// "add" action from workspace state. Shared by the desktop panels and
    /// the mobile drawers so both show the same headers.
    pub(crate) fn panel_tabs(&self, side: Side) -> Vec<PanelTab> {
        match side {
            Side::Left => vec![
                PanelTab::new(
                    IconName::Bot,
                    "Conversations",
                    PanelTabKind::Conversations,
                    3,
                ),
                PanelTab::new(
                    IconName::Folder,
                    "Files",
                    PanelTabKind::Files,
                    self.open_files.len(),
                ),
                PanelTab::new(IconName::CircleCheck, "Task", PanelTabKind::Task, 5),
                PanelTab::new(
                    IconName::BookOpen,
                    "Scratch Notes",
                    PanelTabKind::ScratchNotes,
                    self.scratch_notes.len(),
                )
                .with_action(PanelAction::new(
                    "left-scratch-add",
                    IconName::Plus,
                    "New Scratch Note",
                )),
            ],
            Side::Right => vec![
                PanelTab::new(IconName::GitHub, "Git", PanelTabKind::Git, 2),
                PanelTab::new(
                    IconName::Inbox,
                    "Pull Request",
                    PanelTabKind::PullRequest,
                    1,
                ),
                PanelTab::new(IconName::Inspector, "Context", PanelTabKind::Context, 4),
            ],
        }
    }

    /// Handle the header action ("+") of the given side panel tab.
    pub(crate) fn panel_add(&mut self, side: Side, index: usize, cx: &mut Context<Self>) {
        if let Some(PanelTabKind::ScratchNotes) =
            self.panel_tabs(side).get(index).map(|tab| tab.kind)
        {
            self.add_scratch_note(cx);
        }
    }

    fn add_scratch_note(&mut self, cx: &mut Context<Self>) {
        let name = self.next_scratch_note_name();
        self.scratch_notes.push(name);
        cx.notify();
    }

    /// Unique name for the next scratch note. Pure so the counter can be
    /// unit tested without a context.
    fn next_scratch_note_name(&mut self) -> SharedString {
        loop {
            let name = SharedString::from(format!("Scratch note {}", self.next_scratch_note));
            self.next_scratch_note += 1;
            if !self.scratch_notes.contains(&name) {
                return name;
            }
        }
    }

    /// Open a new untitled file from the "+" button.
    fn open_untitled(&mut self, cx: &mut Context<Self>) {
        loop {
            let name = SharedString::from(format!("untitled-{}.txt", self.next_untitled));
            self.next_untitled += 1;
            if !self.open_files.contains(&name) {
                self.select_file(&name);
                break;
            }
        }
        cx.notify();
    }

    fn start_resize(
        &mut self,
        target: ResizeTarget,
        _: &MouseDownEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.active_resize = Some(target);
        cx.notify();
    }

    fn resize(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.active_resize else {
            return;
        };

        if !event.dragging() {
            self.active_resize = None;
            cx.notify();
            return;
        }

        self.resize_to(target, event.position);
        cx.notify();
    }

    fn stop_resize(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.active_resize.take().is_some() {
            cx.notify();
        }
    }

    fn resize_to(&mut self, target: ResizeTarget, position: Point<Pixels>) {
        let handle_offset = HANDLE_SIZE / 2.;

        match target {
            // Panels have no hard max width: the only upper bound is the space
            // left over after keeping the min widths of the neighboring regions.
            ResizeTarget::Left => {
                let available =
                    self.bounds.size.width - self.right_width - CENTER_MIN - HANDLE_SIZE * 2.;
                let max_width = available.max(LEFT_MIN);
                self.left_width =
                    (position.x - self.bounds.left() - handle_offset).clamp(LEFT_MIN, max_width);
            }
            ResizeTarget::Right => {
                let available =
                    self.bounds.size.width - self.left_width - CENTER_MIN - HANDLE_SIZE * 2.;
                let max_width = available.max(RIGHT_MIN);
                self.right_width =
                    (self.bounds.right() - position.x - handle_offset).clamp(RIGHT_MIN, max_width);
            }
            ResizeTarget::Bottom => {
                let available = self.bounds.size.height - CONTENT_MIN - HANDLE_SIZE;
                let max_height = available.max(BOTTOM_MIN);
                self.bottom_height = (self.bounds.bottom() - position.y - handle_offset)
                    .clamp(BOTTOM_MIN, max_height);
            }
        }
    }

    /// A draggable divider between resizable regions. The highlighted color
    /// shows while the user is dragging this handle.
    fn resize_handle(
        &self,
        orientation: HandleOrientation,
        id: &'static str,
        target: ResizeTarget,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let color = if self.active_resize == Some(target) {
            cx.theme().drag_border
        } else {
            cx.theme().border
        };
        let divider = match orientation {
            HandleOrientation::Vertical => div().w(DIVIDER_SIZE).h_full().bg(color),
            HandleOrientation::Horizontal => div().w_full().h(DIVIDER_SIZE).bg(color),
        };
        let handle = match orientation {
            HandleOrientation::Vertical => div()
                .w(HANDLE_SIZE)
                .h_full()
                .flex_none()
                .flex()
                .justify_center()
                .cursor_col_resize(),
            HandleOrientation::Horizontal => div()
                .w_full()
                .h(HANDLE_SIZE)
                .flex_none()
                .flex()
                .items_center()
                .cursor_row_resize(),
        };

        handle.id(id).child(divider).on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, event, window, cx| {
                this.start_resize(target, event, window, cx)
            }),
        )
    }

    /// One side of the three-column layout: the panel plus its resize handle.
    /// The handle comes before the panel on the right side and after it on
    /// the left side. The wrapper must be a flex row so the panel and the
    /// handle sit side by side (gpui divs default to block layout).
    fn side_column(&self, column: &SideColumn, cx: &mut Context<Self>) -> impl IntoElement {
        let on_click = column.on_click.clone();
        let side = column.side;
        let entity = cx.entity().clone();
        let on_add: IndexCallback = Rc::new(move |ix, _window, cx| {
            entity.update(cx, |this, cx| this.panel_add(side, *ix, cx));
        });
        let panel = div()
            .w(column.width)
            .h_full()
            .flex_none()
            .overflow_hidden()
            .child(
                SidePanel::new(side, self.panel_tabs(side))
                    .selected(column.selected)
                    .on_click(move |ix, window, cx| on_click(ix, window, cx))
                    .on_add(move |ix, window, cx| on_add(ix, window, cx)),
            );
        let handle = self.resize_handle(
            HandleOrientation::Vertical,
            column.handle_id,
            column.target,
            cx,
        );

        match column.side {
            Side::Left => div().h_full().flex().flex_none().child(panel).child(handle),
            Side::Right => div().h_full().flex().flex_none().child(handle).child(panel),
        }
    }

    fn center_column(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let bottom_visible = self.bottom_visible;
        let entity = cx.entity().clone();

        let on_content_tab = {
            let entity = entity.clone();
            move |ix: &usize, _: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| {
                    this.content_tab = *ix;
                    cx.notify();
                });
            }
        };
        let on_close_content_tab = {
            let entity = entity.clone();
            move |ix: &usize, _: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| this.close_file(*ix, cx));
            }
        };
        let on_add_content_file = {
            let entity = entity.clone();
            move |_: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| this.open_untitled(cx));
            }
        };

        div()
            .h_full()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .when(!self.is_mobile, |this| this.min_w(CENTER_MIN))
            .child(
                div()
                    .w_full()
                    .min_h(CONTENT_MIN)
                    .flex_1()
                    .overflow_hidden()
                    .child(
                        ContentArea::new(self.content_tab, self.open_files.clone())
                            .on_click(on_content_tab)
                            .on_close(on_close_content_tab)
                            .on_add(on_add_content_file),
                    ),
            )
            .when(bottom_visible, |this| {
                this.child(self.resize_handle(
                    HandleOrientation::Horizontal,
                    "bottom-resize-handle",
                    ResizeTarget::Bottom,
                    cx,
                ))
            })
            .when(bottom_visible, |this| {
                this.child(
                    div()
                        .w_full()
                        .h(self.bottom_height)
                        .flex_none()
                        .overflow_hidden()
                        .child(BottomPanel),
                )
            })
    }
}

impl Render for WorkspaceLayout {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity().clone();
        let on_left_tab: IndexCallback = Rc::new({
            let entity = entity.clone();
            move |ix: &usize, _: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| {
                    this.left_tab = *ix;
                    cx.notify();
                });
            }
        });
        let on_right_tab: IndexCallback = Rc::new({
            let entity = entity.clone();
            move |ix: &usize, _: &mut Window, cx: &mut App| {
                entity.update(cx, |this, cx| {
                    this.right_tab = *ix;
                    cx.notify();
                });
            }
        });
        let active_resize = self.active_resize;
        let left_visible = self.left_visible;
        let right_visible = self.right_visible;
        let is_mobile = self.is_mobile;
        let left_column = SideColumn {
            side: Side::Left,
            width: self.left_width,
            handle_id: "left-resize-handle",
            target: ResizeTarget::Left,
            selected: self.left_tab,
            on_click: on_left_tab,
        };
        let right_column = SideColumn {
            side: Side::Right,
            width: self.right_width,
            handle_id: "right-resize-handle",
            target: ResizeTarget::Right,
            selected: self.right_tab,
            on_click: on_right_tab,
        };

        div()
            .id("workspace-layout")
            .size_full()
            .min_w(px(0.))
            .min_h_0()
            .flex()
            .overflow_hidden()
            .when(
                matches!(
                    active_resize,
                    Some(ResizeTarget::Left | ResizeTarget::Right)
                ),
                |this| this.cursor_col_resize(),
            )
            .when(active_resize == Some(ResizeTarget::Bottom), |this| {
                this.cursor_row_resize()
            })
            .on_mouse_move(cx.listener(Self::resize))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::stop_resize))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |this, cx| {
                            if this.bounds != bounds {
                                this.bounds = bounds;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .when(!is_mobile, |this| {
                this.when(left_visible, |this| {
                    this.child(self.side_column(&left_column, cx))
                })
            })
            .child(self.center_column(cx))
            .when(!is_mobile, |this| {
                this.when(right_visible, |this| {
                    this.child(self.side_column(&right_column, cx))
                })
            })
    }
}

#[derive(IntoElement)]
struct BottomPanel;

impl gpui::RenderOnce for BottomPanel {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .bg(cx.theme().tab_bar)
            .text_color(cx.theme().foreground)
            .text_sm()
            .child("Bottom Panel")
    }
}

#[cfg(test)]
mod tests {
    use gpui::{Bounds, Modifiers, TestAppContext, point, size};

    use super::*;

    fn layout() -> WorkspaceLayout {
        WorkspaceLayout {
            bounds: Bounds {
                origin: point(px(10.), px(20.)),
                size: size(px(1200.), px(800.)),
            },
            ..WorkspaceLayout::new()
        }
    }

    #[gpui::test]
    fn side_panel_renders_and_add_creates_scratch_notes(cx: &mut TestAppContext) {
        cx.update(|cx| {
            gpui_component::init(cx);
            crate::theme::apply_default_theme(cx);
        });

        let (workspace, cx) = cx.add_window_view(|_window, _cx| {
            let mut layout = WorkspaceLayout::new();
            // Open the Scratch Notes tab so its "+" header action is visible.
            layout.left_tab = 3;
            layout
        });

        // Produce a frame so element bounds are registered, then click the
        // Scratch Notes "+" header action (scratch notes is the 4th tab and
        // selected by default).
        let _ = cx.update(|window, app| window.draw(app));
        let header_bounds = cx
            .debug_bounds("panel-header")
            .expect("panel header should render");
        let add_bounds = cx
            .debug_bounds("left-scratch-add-debug")
            .expect("scratch notes add button should render");
        // The action lives inside the header row, above the content area.
        assert!(add_bounds.origin.y >= header_bounds.origin.y);
        assert!(add_bounds.origin.y < header_bounds.bottom());

        cx.simulate_click(add_bounds.center(), Modifiers::none());

        let count = cx.read(|app| workspace.read(app).scratch_notes.len());
        assert_eq!(count, 3, "clicking + should create a scratch note");
    }

    #[test]
    fn panel_tabs_reflect_workspace_state() {
        let mut layout = WorkspaceLayout::new();
        layout.open_files = vec!["a.rs".into(), "b.rs".into()];
        layout.scratch_notes = vec!["note 1".into()];

        let left = layout.panel_tabs(Side::Left);
        assert_eq!(left.len(), 4);
        assert_eq!(left[1].kind, PanelTabKind::Files);
        assert_eq!(left[1].count, 2);
        assert_eq!(left[3].kind, PanelTabKind::ScratchNotes);
        assert_eq!(left[3].count, 1);
        assert!(left[3].action.is_some());

        let right = layout.panel_tabs(Side::Right);
        assert_eq!(right.len(), 3);
        assert!(right.iter().all(|tab| tab.action.is_none()));
    }

    #[test]
    fn scratch_notes_grow_with_unique_names() {
        let mut layout = WorkspaceLayout::new();
        layout.scratch_notes = vec!["Scratch note 1".into()];
        layout.next_scratch_note = 3;

        let name = layout.next_scratch_note_name();
        assert_eq!(name, "Scratch note 3");

        layout.scratch_notes.push(name);
        let next = layout.next_scratch_note_name();
        assert_eq!(next, "Scratch note 4");
    }

    #[test]
    fn side_tab_state_round_trips() {
        let mut layout = WorkspaceLayout::new();

        assert_eq!(layout.tab_for(Side::Left), 0);
        assert_eq!(layout.tab_for(Side::Right), 0);

        layout.set_tab(Side::Left, 2);
        layout.set_tab(Side::Right, 1);

        assert_eq!(layout.tab_for(Side::Left), 2);
        assert_eq!(layout.tab_for(Side::Right), 1);
    }

    #[test]
    fn open_and_close_files_manage_selection() {
        let mut layout = WorkspaceLayout::new();
        layout.open_files = vec!["a.rs".into(), "b.rs".into(), "c.rs".into()];
        layout.content_tab = 1;

        // Opening an already-open file just focuses it.
        layout.select_file(&"c.rs".into());
        assert_eq!(layout.content_tab, 2);

        // Opening a new file appends it and makes it active.
        layout.select_file(&"d.rs".into());
        assert_eq!(layout.open_files.len(), 4);
        assert_eq!(layout.open_files[3], "d.rs");
        assert_eq!(layout.content_tab, 3);

        // Closing a tab after the active one keeps the selection.
        layout.close_file_at(3);
        assert_eq!(layout.content_tab, 2);

        // Closing a tab before the active one shifts the selection left.
        layout.close_file_at(0);
        assert_eq!(layout.content_tab, 1);
        assert_eq!(layout.open_files, ["b.rs", "c.rs"]);

        // Closing the active tab activates its right neighbor.
        layout.close_file_at(1);
        assert_eq!(layout.content_tab, 0);
        assert_eq!(layout.open_files, ["b.rs"]);

        // Closing the last tab leaves an empty (unselected) strip.
        layout.close_file_at(0);
        assert!(layout.open_files.is_empty());
        assert_eq!(layout.content_tab, 0);

        // Out-of-range closes are ignored.
        layout.close_file_at(0);
        assert_eq!(layout.content_tab, 0);
    }

    #[test]
    fn side_panels_visible_bottom_hidden_by_default() {
        let layout = WorkspaceLayout::new();

        assert!(layout.left_visible);
        assert!(layout.right_visible);
        assert!(!layout.bottom_visible);
        assert!(!layout.is_mobile);
    }

    #[test]
    fn left_resize_uses_workspace_origin_and_constraints() {
        let mut layout = layout();

        layout.resize_to(ResizeTarget::Left, point(px(312.5), px(100.)));
        assert_eq!(layout.left_width, px(300.));

        layout.resize_to(ResizeTarget::Left, point(px(0.), px(100.)));
        assert_eq!(layout.left_width, LEFT_MIN);

        // No hard max: the panel can grow until the center and right panels
        // reach their min widths.
        layout.resize_to(ResizeTarget::Left, point(px(1000.), px(100.)));
        assert_eq!(layout.left_width, px(710.));
    }

    #[test]
    fn right_resize_uses_workspace_edge_and_constraints() {
        let mut layout = layout();

        layout.resize_to(ResizeTarget::Right, point(px(907.5), px(100.)));
        assert_eq!(layout.right_width, px(300.));

        layout.resize_to(ResizeTarget::Right, point(px(1200.), px(100.)));
        assert_eq!(layout.right_width, RIGHT_MIN);

        // No hard max: the panel can grow until the left and center panels
        // reach their min widths.
        layout.resize_to(ResizeTarget::Right, point(px(100.), px(100.)));
        assert_eq!(layout.right_width, px(730.));
    }

    #[test]
    fn bottom_resize_uses_workspace_bottom_and_constraints() {
        let mut layout = layout();

        layout.resize_to(ResizeTarget::Bottom, point(px(100.), px(617.5)));
        assert_eq!(layout.bottom_height, px(200.));

        layout.resize_to(ResizeTarget::Bottom, point(px(100.), px(810.)));
        assert_eq!(layout.bottom_height, BOTTOM_MIN);

        // No hard max: the panel can grow until the center content reaches
        // its min height.
        layout.resize_to(ResizeTarget::Bottom, point(px(100.), px(100.)));
        assert_eq!(layout.bottom_height, px(675.));
    }
}
