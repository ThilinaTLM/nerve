use std::fs;
use std::path::{Path, PathBuf};

/// Read-only Git operations supplied by the package composition boundary.
/// Function pointers keep the port stateless, matching the existing free functions.
#[derive(Clone, Copy)]
pub struct GitReadPort {
    pub directory: fn(&Path) -> Result<PathBuf, String>,
    pub fingerprint: fn(&Path) -> Result<u64, String>,
}

pub(crate) fn watch_paths(
    repository: &Path,
    maximum: usize,
    reads: GitReadPort,
) -> Result<Vec<PathBuf>, String> {
    let git_dir = (reads.directory)(repository)?;
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
    use super::*;

    #[test]
    fn watch_plan_uses_injected_directory_and_preserves_errors() {
        let reads = GitReadPort {
            directory: |_| Err("synthetic read error".into()),
            fingerprint: |_| Ok(42),
        };
        assert_eq!(
            watch_paths(Path::new("synthetic"), 16, reads),
            Err("synthetic read error".into())
        );
    }

    #[test]
    fn watch_plan_bounds_paths_and_omits_objects_with_injected_reads() {
        let root = std::env::temp_dir().join(format!(
            "nerve-monitor-port-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        let reads = GitReadPort {
            directory: |repository| Ok(repository.join(".git")),
            fingerprint: |_| Ok(42),
        };
        let paths = watch_paths(&root, 16, reads).unwrap();
        assert_eq!(
            paths,
            vec![
                root.clone(),
                root.join(".git"),
                root.join(".git/refs"),
                root.join(".git/refs/heads")
            ]
        );
        assert_eq!(watch_paths(&root, 2, reads).unwrap(), paths[..2]);
        fs::remove_dir_all(root).unwrap();
    }
}
