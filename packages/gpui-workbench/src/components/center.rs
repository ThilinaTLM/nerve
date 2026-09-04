use std::rc::Rc;

use gpui::{App, IntoElement, SharedString, Window, div, prelude::*, px};
use gpui_component::{
    IconName, Sizable as _,
    button::{Button, ButtonVariants as _},
    tab::{Tab, TabBar},
};

use super::callbacks::{ActionCallback, IndexCallback};
use super::placeholder::Placeholder;

/// Minimum width of an open-file tab so tabs stay usable when many files are
/// open (small on purpose).
const CONTENT_TAB_MIN_WIDTH: gpui::Pixels = px(80.);

/// The editor area of the center column: a VS Code-like tab strip of open
/// files (each closeable), plus the content region for the active file.
#[derive(IntoElement)]
pub struct ContentArea {
    files: Vec<SharedString>,
    active: usize,
    on_click: Option<IndexCallback>,
    on_close: Option<IndexCallback>,
    on_add: Option<ActionCallback>,
}

impl ContentArea {
    pub fn new(active: usize, files: Vec<SharedString>) -> Self {
        Self {
            files,
            active,
            on_click: None,
            on_close: None,
            on_add: None,
        }
    }

    pub fn on_click(mut self, handler: impl Fn(&usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    pub fn on_close(mut self, handler: impl Fn(&usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    pub fn on_add(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_add = Some(Rc::new(handler));
        self
    }
}

impl gpui::RenderOnce for ContentArea {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let empty = self.files.is_empty();
        let active = if empty {
            0
        } else {
            self.active.min(self.files.len() - 1)
        };
        let active_label = self.files.get(active).cloned();
        let on_close = self.on_close.clone();

        // Placeholder shown in the content region when the active file's
        // content is not implemented yet (and for the empty strip).
        let content = active_label
            .map(|label| Placeholder::new(IconName::File, label))
            .unwrap_or_else(|| Placeholder::new(IconName::File, "No files open"))
            .with_background();

        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .child(
                TabBar::new("content-tabs")
                    .children(self.files.iter().enumerate().map(|(ix, name)| {
                        let name = name.clone();
                        let on_close = on_close.clone();
                        Tab::default()
                            .child(div().min_w(CONTENT_TAB_MIN_WIDTH).child(name))
                            .suffix(
                                Button::new(SharedString::from(format!("content-close-{ix}")))
                                    .icon(IconName::Close)
                                    .ghost()
                                    .xsmall()
                                    .on_click(move |_, window, cx| {
                                        // Don't let the click select this tab.
                                        cx.stop_propagation();
                                        if let Some(on_close) = &on_close {
                                            on_close(&ix, window, cx);
                                        }
                                    }),
                            )
                    }))
                    .selected_index(active)
                    .suffix(
                        Button::new("content-add")
                            .icon(IconName::Plus)
                            .ghost()
                            .small()
                            .when_some(self.on_add.clone(), |this, on_add| {
                                this.on_click(move |_, window, cx| on_add(window, cx))
                            }),
                    )
                    .when_some(self.on_click.clone(), |this, on_click| {
                        this.on_click(move |ix, window, cx| on_click(ix, window, cx))
                    }),
            )
            .child(content)
    }
}
