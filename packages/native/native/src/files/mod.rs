//! Ignore-aware project file primitives: directory listing, a fuzzy path index
//! and content search. Plain Rust; the N-API adapter is `napi.rs`.
mod content;
mod listing;
pub(crate) mod napi;
mod path_index;

use std::path::{Component, Path, PathBuf};

/// Validates a project-relative path ("" is the root) and joins it to `root`.
pub(crate) fn resolve_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut joined = root.to_path_buf();
    for segment in relative.split(['/', '\\']).filter(|part| !part.is_empty()) {
        if segment == "." {
            continue;
        }
        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => joined.push(segment),
            _ => return Err(format!("Invalid project path segment: {segment}")),
        }
    }
    Ok(joined)
}

/// Project-relative path with "/" separators; `None` outside the root.
pub(crate) fn relative_slash(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut out = String::new();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return None;
        };
        if !out.is_empty() {
            out.push('/');
        }
        out.push_str(name.to_str()?);
    }
    Some(out)
}
