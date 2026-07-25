use std::sync::Arc;
use std::{fs, path::Path, time::Instant};

use anyhow::{Context as _, Result};
use serde::Serialize;
use sha2::{Digest as _, Sha256};

use gpui::{AnyElement, ListAlignment, ListState, div, list, prelude::*, px};

#[derive(Debug, Clone)]
pub(crate) enum EvaluationRowKind {
    User,
    Assistant,
    Thinking,
    Tool,
    Error,
}

#[derive(Debug, Clone)]
pub(crate) struct EvaluationRow {
    pub(crate) key: String,
    pub(crate) kind: EvaluationRowKind,
    pub(crate) text: String,
}

pub(crate) struct EvaluationScene {
    rows: Arc<Vec<EvaluationRow>>,
    list_state: ListState,
}

impl EvaluationScene {
    pub(crate) fn new(row_count: usize) -> Self {
        let rows = Arc::new(generate_rows(row_count));
        Self {
            list_state: ListState::new(rows.len(), ListAlignment::Top, px(500.0)),
            rows,
        }
    }

    pub(crate) fn render_with_composer(&self, composer: impl IntoElement) -> AnyElement {
        let rows = Arc::clone(&self.rows);
        let transcript = list(self.list_state.clone(), move |index, _window, _cx| {
            let row = &rows[index];
            let (label, color) = match row.kind {
                EvaluationRowKind::User => ("YOU", crate::ui::theme::ACCENT),
                EvaluationRowKind::Assistant => ("NERVE", crate::ui::theme::TEXT),
                EvaluationRowKind::Thinking => ("THINKING", crate::ui::theme::MUTED),
                EvaluationRowKind::Tool => ("TOOL", crate::ui::theme::ACCENT),
                EvaluationRowKind::Error => ("ERROR", crate::ui::theme::ERROR),
            };
            div()
                .id(gpui::SharedString::from(row.key.clone()))
                .mx(px(18.0))
                .my(px(5.0))
                .p(px(12.0))
                .rounded_md()
                .bg(crate::ui::theme::PANEL)
                .border_1()
                .border_color(crate::ui::theme::BORDER)
                .child(div().text_xs().text_color(color).child(label))
                .child(
                    div()
                        .mt(px(6.0))
                        .text_sm()
                        .line_height(gpui::relative(1.45))
                        .child(row.text.clone()),
                )
                .into_any_element()
        });

        div()
            .flex_1()
            .h_full()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .px(px(18.0))
                    .pt(px(16.0))
                    .text_lg()
                    .child("Native transcript renderer"),
            )
            .child(
                div()
                    .px(px(18.0))
                    .pt(px(6.0))
                    .pb(px(10.0))
                    .text_sm()
                    .text_color(crate::ui::theme::MUTED)
                    .child(format!(
                        "{} deterministic variable-height rows · lazily rendered",
                        self.rows.len()
                    )),
            )
            .child(div().flex_1().min_h_0().child(transcript))
            .child(
                div()
                    .m(px(12.0))
                    .mt(px(6.0))
                    .h(px(76.0))
                    .rounded_md()
                    .border_1()
                    .border_color(crate::ui::theme::BORDER)
                    .bg(crate::ui::theme::PANEL)
                    .p(px(12.0))
                    .child(composer),
            )
            .into_any_element()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelMetrics {
    schema_version: u8,
    row_count: usize,
    generation_ms: f64,
    update_ms: f64,
    checksum_sha256: String,
    note: &'static str,
}

pub(crate) fn write_model_metrics(path: &Path) -> Result<()> {
    let generation_started = Instant::now();
    let mut rows = generate_rows(10_000);
    let generation_ms = generation_started.elapsed().as_secs_f64() * 1_000.0;

    let update_started = Instant::now();
    for index in (0..rows.len()).step_by(10) {
        rows[index].text.push_str(" streaming-update");
    }
    let update_ms = update_started.elapsed().as_secs_f64() * 1_000.0;

    let mut digest = Sha256::new();
    for row in &rows {
        digest.update(row.key.as_bytes());
        digest.update(row.text.as_bytes());
    }
    let metrics = ModelMetrics {
        schema_version: 1,
        row_count: rows.len(),
        generation_ms,
        update_ms,
        checksum_sha256: format!("{:x}", digest.finalize()),
        note: "CPU model fixture only; interactive GPUI frame/input measurements remain manual",
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("create benchmark output directory")?;
    }
    fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&metrics)?),
    )
    .context("write native model metrics")?;
    Ok(())
}

fn generate_rows(count: usize) -> Vec<EvaluationRow> {
    (0..count)
        .map(|index| {
            let kind = match index % 11 {
                0 | 6 => EvaluationRowKind::User,
                1 | 2 | 7 | 8 => EvaluationRowKind::Assistant,
                3 => EvaluationRowKind::Thinking,
                4 | 9 => EvaluationRowKind::Tool,
                _ => EvaluationRowKind::Error,
            };
            let repetition = 1 + (index % 5);
            let body = match kind {
                EvaluationRowKind::User => "Please inspect the current implementation and explain the next concrete change.",
                EvaluationRowKind::Assistant => "I inspected the protocol boundary and kept the daemon authoritative. The native client applies each event before advancing its cursor.",
                EvaluationRowKind::Thinking => "Evaluating renderer cost, list measurement, replay ordering, and snapshot recovery.",
                EvaluationRowKind::Tool => "read packages/contracts/src/domains/protocol/messages.schema.ts\nCompleted successfully.",
                EvaluationRowKind::Error => "Evaluation fixture: recoverable operation error with structured details.",
            };
            EvaluationRow {
                key: format!("evaluation-row-{index}"),
                kind,
                text: std::iter::repeat_n(body, repetition).collect::<Vec<_>>().join(" "),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_stable_mixed_rows() {
        let rows = generate_rows(10_000);
        assert_eq!(rows.len(), 10_000);
        assert_eq!(rows[9_999].key, "evaluation-row-9999");
        assert!(
            rows.iter()
                .any(|row| matches!(row.kind, EvaluationRowKind::Tool))
        );
    }
}
