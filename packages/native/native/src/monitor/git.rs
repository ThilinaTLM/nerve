use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::git::{SnapshotOptions, read_repository_info, read_snapshot};

pub(crate) fn watch_paths(repository: &Path, maximum: usize) -> Result<Vec<PathBuf>, String> {
    let repository_text = repository.to_string_lossy();
    let info = read_repository_info(&repository_text).map_err(|error| error.to_string())?;
    let git_dir = PathBuf::from(info.git_dir);
    let common_dir = common_git_dir(&git_dir).unwrap_or_else(|| git_dir.clone());
    let candidates = [
        repository.to_path_buf(),
        git_dir.clone(),
        common_dir.clone(),
        common_dir.join("refs"),
        common_dir.join("refs/heads"),
        common_dir.join("refs/remotes"),
        common_dir.join("refs/tags"),
        common_dir.join("logs"),
        git_dir.join("rebase-apply"),
        git_dir.join("rebase-merge"),
        git_dir.join("sequencer"),
    ];
    let mut result = Vec::new();
    for path in candidates {
        if path.is_dir() && !result.contains(&path) {
            result.push(path);
            if result.len() == maximum {
                break;
            }
        }
    }
    Ok(result)
}

pub(crate) fn fingerprint(repository: &Path) -> Result<u64, String> {
    let snapshot = read_snapshot(
        &repository.to_string_lossy(),
        SnapshotOptions {
            include_ignored: false,
            ..SnapshotOptions::default()
        },
    )
    .map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    format!("{snapshot:?}").hash(&mut hasher);
    Ok(hasher.finish())
}

fn common_git_dir(git_dir: &Path) -> Option<PathBuf> {
    let value = fs::read_to_string(git_dir.join("commondir")).ok()?;
    let path = PathBuf::from(value.trim());
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(if path.is_absolute() {
        path
    } else {
        git_dir.join(path)
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn watch_plan_never_names_objects() {
        let paths = [".git", ".git/refs", ".git/logs"];
        assert!(paths.iter().all(|path| !path.contains("objects")));
    }
}
