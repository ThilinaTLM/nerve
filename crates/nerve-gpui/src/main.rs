mod app;
mod assets;
mod components;
mod state;
mod theme;
mod view_model;
mod views;

use std::path::PathBuf;

use app::{SelectNextConversation, SelectPreviousConversation, ToggleSidebar, Workbench};
use assets::{NerveAssets, register_fonts};
use clap::Parser;
use gpui::{
    App, AppContext, Application, Bounds, KeyBinding, WindowBounds, WindowOptions, px, size,
};
use nerve_client::{ConnectionOptions, resolve_connection};
use theme::ThemeMode;

#[derive(Debug, Parser)]
#[command(
    name = "nerve-gpui",
    about = "Experimental native GPUI client for Nerve"
)]
struct Cli {
    /// Existing Nerve daemon HTTP(S) origin.
    #[arg(long)]
    connect: Option<String>,
    /// Token for an explicit daemon connection. Prefer NERVE_DAEMON_TOKEN.
    #[arg(long)]
    token: Option<String>,
    /// Override local Nerve home discovery.
    #[arg(long, env = "NERVE_HOME")]
    nerve_home: Option<PathBuf>,
    /// Native interface appearance.
    #[arg(long, value_enum, default_value_t)]
    theme: ThemeMode,
}

fn main() {
    let cli = Cli::parse();
    let config = resolve_connection(&ConnectionOptions {
        connect: cli.connect,
        token: cli.token,
        nerve_home: cli.nerve_home,
    })
    .unwrap_or_else(|error| {
        eprintln!("nerve-gpui: {error}");
        std::process::exit(2);
    });
    let theme_mode = cli.theme;

    Application::new()
        .with_assets(NerveAssets)
        .run(move |cx: &mut App| {
            if let Err(error) = register_fonts(cx) {
                eprintln!("nerve-gpui: cannot register bundled fonts: {error}");
            }
            cx.bind_keys([
                KeyBinding::new("ctrl-b", ToggleSidebar, Some("NerveWorkbench")),
                KeyBinding::new("up", SelectPreviousConversation, Some("NerveWorkbench")),
                KeyBinding::new("down", SelectNextConversation, Some("NerveWorkbench")),
            ]);
            let bounds = Bounds::centered(None, size(px(1200.), px(800.)), cx);
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(gpui::TitlebarOptions {
                        title: Some("Nerve — Experimental GPUI".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                |window, cx| cx.new(|cx| Workbench::new(config.clone(), theme_mode, window, cx)),
            )
            .expect("open Nerve GPUI window");
            cx.activate(true);
        });
}
