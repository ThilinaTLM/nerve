//! Shared ignore semantics for the files and monitor domains: one walker
//! configuration plus a single-path matcher that follows the same precedence.
use ignore::WalkBuilder;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

pub(crate) const GIT_DIRECTORY: &str = ".git";

/// Walker over `root` that honors `.gitignore`, `.ignore`, `.git/info/exclude`
/// and global excludes with or without a Git repository, includes dotfiles and
/// never yields `.git`. Symlinks are not followed.
pub(crate) fn walk_builder(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| entry.file_name() != GIT_DIRECTORY);
    builder
}

#[derive(Default)]
struct Layer {
    ignore: Option<Gitignore>,
    gitignore: Option<Gitignore>,
}

/// Answers "is this path ignored?" for arbitrary paths below a root, with a
/// per-directory rule cache. Call `invalidate` after ignore files change.
pub(crate) struct IgnoreMatcher {
    root: PathBuf,
    base: PathBuf,
    exclude: Option<Gitignore>,
    global: Gitignore,
    layers: HashMap<PathBuf, Layer>,
    directories: HashMap<PathBuf, bool>,
}

impl IgnoreMatcher {
    pub(crate) fn new(root: &Path) -> Self {
        let base = root
            .ancestors()
            .find(|candidate| candidate.join(GIT_DIRECTORY).exists())
            .unwrap_or(root)
            .to_path_buf();
        let mut exclude = None;
        let info_exclude = base.join(GIT_DIRECTORY).join("info").join("exclude");
        if info_exclude.is_file() {
            let mut builder = GitignoreBuilder::new(&base);
            let _ = builder.add(&info_exclude);
            exclude = builder.build().ok();
        }
        Self {
            root: root.to_path_buf(),
            base,
            exclude,
            global: Gitignore::global().0,
            layers: HashMap::new(),
            directories: HashMap::new(),
        }
    }

    pub(crate) fn invalidate(&mut self) {
        self.layers.clear();
        self.directories.clear();
    }

    /// `path` must be absolute and inside the root (lexically).
    pub(crate) fn is_ignored(&mut self, path: &Path, is_dir: bool) -> bool {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return false;
        };
        let mut current = self.root.clone();
        let components: Vec<_> = relative
            .components()
            .filter_map(|component| match component {
                Component::Normal(name) => Some(name.to_os_string()),
                _ => None,
            })
            .collect();
        for (index, name) in components.iter().enumerate() {
            if name == GIT_DIRECTORY {
                return true;
            }
            current.push(name);
            let last = index + 1 == components.len();
            let directory = !last || is_dir;
            if last {
                return self.decide(&current, directory);
            }
            if self.directory_ignored(&current) {
                return true;
            }
        }
        false
    }

    fn directory_ignored(&mut self, directory: &Path) -> bool {
        if let Some(known) = self.directories.get(directory) {
            return *known;
        }
        let parent_ignored = directory
            .parent()
            .filter(|parent| *parent != self.root && parent.starts_with(&self.root))
            .is_some_and(|parent| self.directory_ignored(parent));
        let ignored = parent_ignored || self.decide(directory, true);
        self.directories.insert(directory.to_path_buf(), ignored);
        ignored
    }

    /// Precedence like `ignore::WalkBuilder`: deeper directories first, `.ignore`
    /// before `.gitignore`, then `info/exclude`, then global excludes.
    fn decide(&mut self, path: &Path, is_dir: bool) -> bool {
        let mut directory = path.parent();
        while let Some(current) = directory {
            if !current.starts_with(&self.base) {
                break;
            }
            let layer = self.layer(current);
            for matcher in [&layer.ignore, &layer.gitignore].into_iter().flatten() {
                let result = matcher.matched(path, is_dir);
                if result.is_ignore() {
                    return true;
                }
                if result.is_whitelist() {
                    return false;
                }
            }
            if current == self.base {
                break;
            }
            directory = current.parent();
        }
        for matcher in [self.exclude.as_ref(), Some(&self.global)]
            .into_iter()
            .flatten()
        {
            let result = matcher.matched(path, is_dir);
            if result.is_ignore() {
                return true;
            }
            if result.is_whitelist() {
                return false;
            }
        }
        false
    }

    fn layer(&mut self, directory: &Path) -> &Layer {
        self.layers
            .entry(directory.to_path_buf())
            .or_insert_with(|| Layer {
                ignore: load(directory, ".ignore"),
                gitignore: load(directory, ".gitignore"),
            })
    }
}

fn load(directory: &Path, name: &str) -> Option<Gitignore> {
    let file = directory.join(name);
    if !file.is_file() {
        return None;
    }
    let mut builder = GitignoreBuilder::new(directory);
    let _ = builder.add(&file);
    builder.build().ok().filter(|rules| !rules.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_support::tempdir;
    use std::fs;

    #[test]
    fn nested_rules_negation_and_ignored_parents_follow_git_precedence() {
        let dir = tempdir("rules");
        fs::create_dir_all(dir.join("src/inner")).unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::write(dir.join(".gitignore"), "build/\n*.log\n").unwrap();
        fs::write(dir.join("src/.gitignore"), "!keep.log\n").unwrap();
        fs::write(dir.join("src/inner/.ignore"), "secret.txt\n").unwrap();
        let mut matcher = IgnoreMatcher::new(&dir);
        assert!(matcher.is_ignored(&dir.join("build"), true));
        assert!(matcher.is_ignored(&dir.join("build/out.js"), false));
        assert!(matcher.is_ignored(&dir.join("a.log"), false));
        assert!(!matcher.is_ignored(&dir.join("src/keep.log"), false));
        assert!(matcher.is_ignored(&dir.join("src/other.log"), false));
        assert!(matcher.is_ignored(&dir.join("src/inner/secret.txt"), false));
        assert!(!matcher.is_ignored(&dir.join("src/main.rs"), false));
        assert!(matcher.is_ignored(&dir.join(".git"), true));
        let _ = fs::remove_dir_all(&dir);
    }
}
