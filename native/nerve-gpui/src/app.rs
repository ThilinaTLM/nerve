use gpui::{App, Application, Bounds, WindowBounds, WindowOptions, prelude::*, px, size};

use crate::{Options, ui::shell::NativeWorkbench};

pub(crate) fn run(options: Options) {
    Application::new().run(move |cx: &mut App| {
        gpui_component::init(cx);
        let bounds = Bounds::centered(None, size(px(1180.0), px(760.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(gpui::TitlebarOptions {
                    title: Some("Nerve Native Evaluation".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            |window, cx| {
                let workbench = cx.new(|cx| NativeWorkbench::new(&options, window, cx));
                cx.new(|cx| gpui_component::Root::new(workbench, window, cx))
            },
        )
        .expect("failed to open native evaluation window");
        cx.activate(true);
    });
}
