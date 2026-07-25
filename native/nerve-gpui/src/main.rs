mod app;
mod daemon;
mod evaluation;
mod protocol;
mod state;
mod ui;

use clap::Parser;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(
    name = "nerve-native",
    about = "Experimental native GPUI workbench for Nerve"
)]
pub(crate) struct Options {
    /// Connect to a specific daemon instead of discovering the local daemon.
    #[arg(long)]
    connect: Option<String>,
    /// Bearer token for --connect. Never persisted or logged.
    #[arg(long, requires = "connect")]
    token: Option<String>,
    /// Write deterministic model-generation metrics as JSON and exit without opening a window.
    #[arg(long)]
    benchmark_model_out: Option<std::path::PathBuf>,
    /// Validate an authenticated workspace snapshot connection and exit without opening a window.
    #[arg(long)]
    probe_daemon: bool,
    /// Open the deterministic renderer evaluation scene without a daemon.
    #[arg(long)]
    evaluation: bool,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "nerve_gpui=info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let options = Options::parse();
    if let Some(path) = &options.benchmark_model_out {
        if let Err(error) = evaluation::write_model_metrics(path) {
            eprintln!("native model benchmark failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    if options.probe_daemon {
        let result = daemon::DaemonConnection::resolve(&options).and_then(|connection| {
            let runtime = tokio::runtime::Runtime::new()?;
            let mut client = protocol::client::ReadOnlyProtocolClient::new(connection);
            let value = runtime.block_on(client.load_workspace_snapshot())?;
            let (workspace, _) = state::workspace::WorkspaceState::from_snapshot_result(value)?;
            println!(
                "native protocol probe succeeded: {} projects, {} conversations",
                workspace.projects.len(),
                workspace.conversations.len()
            );
            Ok(())
        });
        if let Err(error) = result {
            eprintln!("native protocol probe failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    app::run(options);
}
