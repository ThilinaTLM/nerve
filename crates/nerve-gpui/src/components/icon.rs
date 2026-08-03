use gpui::{Hsla, IntoElement, RenderOnce, SharedString, Styled, svg};

#[derive(Clone, Copy)]
pub enum IconName {
    Conversations,
    ReadOnly,
}

impl IconName {
    fn path(self) -> &'static str {
        match self {
            Self::Conversations => "icons/message-square.svg",
            Self::ReadOnly => "icons/lock.svg",
        }
    }
}

#[derive(IntoElement)]
pub struct Icon {
    name: IconName,
    color: Hsla,
    size: f32,
}

impl Icon {
    pub fn new(name: IconName, color: Hsla) -> Self {
        Self {
            name,
            color,
            size: 16.0,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut gpui::Window, _cx: &mut gpui::App) -> impl IntoElement {
        svg()
            .path(SharedString::from(self.name.path()))
            .size(gpui::px(self.size))
            .flex_none()
            .text_color(self.color)
    }
}
