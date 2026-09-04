mod app;
mod components;
mod theme;

use app::AppShell;
use gpui::{App, AppContext, Application, WindowOptions};
use gpui_component::Root;
use gpui_component_assets::Assets;

fn main() {
    Application::new().with_assets(Assets).run(|cx: &mut App| {
        gpui_component::init(cx);
        theme::apply_default_theme(cx);

        cx.open_window(
            WindowOptions {
                focus: true,
                ..Default::default()
            },
            |window, cx| {
                let shell = cx.new(AppShell::new);
                cx.new(|cx| Root::new(shell, window, cx))
            },
        )
        .unwrap();

        cx.activate(true);
    });
}
