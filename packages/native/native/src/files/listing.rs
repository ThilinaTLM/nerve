use super::{relative_slash, resolve_relative};
use crate::core::ignore_rules::{GIT_DIRECTORY, IgnoreMatcher};
use std::cmp::Ordering;
use std::fs;
use std::path::Path;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntryKind {
    File,
    Directory,
    Other,
}

impl EntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
            Self::Other => "other",
        }
    }
    fn rank(self) -> u8 {
        match self {
            Self::Directory => 0,
            Self::File => 1,
            Self::Other => 2,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub symlink: bool,
    pub ignored: bool,
}

/// Lists one directory of `root`, confined to it. Sorted directories first,
/// then case-insensitive natural order (digit runs compare numerically).
pub fn list_directory(
    root: &Path,
    relative: &str,
    include_hidden: bool,
) -> Result<Vec<DirectoryEntry>, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve project root: {error}"))?;
    let directory = resolve_relative(&root, relative)?
        .canonicalize()
        .map_err(|error| format!("Could not read directory: {error}"))?;
    if !directory.starts_with(&root) {
        return Err("Project directory path escapes the project root.".into());
    }
    if !directory.is_dir() {
        return Err(format!("{} is not a directory.", display(relative)));
    }
    let relative_directory = relative_slash(&root, &directory).unwrap_or_default();
    let mut matcher = IgnoreMatcher::new(&root);
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let Ok(item) = item else { continue };
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let symlink = file_type.is_symlink();
        let kind = if symlink {
            symlink_kind(&root, &item.path())
        } else if file_type.is_dir() {
            EntryKind::Directory
        } else if file_type.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        // Git treats a symlink as a file, never as a directory.
        let ignored = name == GIT_DIRECTORY
            || matcher.is_ignored(&item.path(), !symlink && kind == EntryKind::Directory);
        let path = if relative_directory.is_empty() {
            name.clone()
        } else {
            format!("{relative_directory}/{name}")
        };
        entries.push(DirectoryEntry {
            name,
            path,
            kind,
            symlink,
            ignored,
        });
    }
    entries.sort_by(compare_entries);
    Ok(entries)
}

fn display(relative: &str) -> &str {
    if relative.is_empty() { "." } else { relative }
}

fn symlink_kind(root: &Path, path: &Path) -> EntryKind {
    let Ok(target) = path.canonicalize() else {
        return EntryKind::Other;
    };
    if !target.starts_with(root) {
        return EntryKind::Other;
    }
    match fs::metadata(&target) {
        Ok(info) if info.is_dir() => EntryKind::Directory,
        Ok(info) if info.is_file() => EntryKind::File,
        _ => EntryKind::Other,
    }
}

fn compare_entries(left: &DirectoryEntry, right: &DirectoryEntry) -> Ordering {
    left.kind
        .rank()
        .cmp(&right.kind.rank())
        .then_with(|| natural(&left.name.to_lowercase(), &right.name.to_lowercase()))
        .then_with(|| natural(&left.name, &right.name))
        .then_with(|| left.path.cmp(&right.path))
}

/// Natural order: digit runs compare by numeric value, other text by code point.
pub(crate) fn natural(left: &str, right: &str) -> Ordering {
    let (mut a, mut b) = (left.chars().peekable(), right.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut digits = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(c);
                        it.next();
                    }
                    digits
                };
                let (x, y) = (take(&mut a), take(&mut b));
                let (tx, ty) = (x.trim_start_matches('0'), y.trim_start_matches('0'));
                let order = tx
                    .len()
                    .cmp(&ty.len())
                    .then_with(|| tx.cmp(ty))
                    .then_with(|| x.len().cmp(&y.len()));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                a.next();
                b.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_support::tempdir;

    #[test]
    fn lists_sorted_with_ignored_flags_and_confines_to_root() {
        let root = tempdir("listing");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
        for file in ["file10.txt", "file2.txt", "B.txt", "a.txt", "x.log"] {
            fs::write(root.join(file), "").unwrap();
        }
        let entries = list_directory(&root, "", true).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            [
                ".git",
                "node_modules",
                "src",
                ".gitignore",
                "a.txt",
                "B.txt",
                "file2.txt",
                "file10.txt",
                "x.log"
            ]
        );
        let ignored: Vec<_> = entries
            .iter()
            .filter(|e| e.ignored)
            .map(|e| &e.name[..])
            .collect();
        assert_eq!(ignored, [".git", "node_modules", "x.log"]);
        assert!(
            !list_directory(&root, "", false)
                .unwrap()
                .iter()
                .any(|e| e.name.starts_with('.'))
        );
        assert!(list_directory(&root, "../", true).is_err());
        let inner = list_directory(&root, "node_modules", true).unwrap();
        assert!(inner.is_empty());
        fs::write(root.join("node_modules/dep.js"), "").unwrap();
        assert!(list_directory(&root, "node_modules", true).unwrap()[0].ignored);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("src", root.join("link")).unwrap();
            std::os::unix::fs::symlink("/etc", root.join("outside")).unwrap();
            let entries = list_directory(&root, "", true).unwrap();
            let link = entries.iter().find(|e| e.name == "link").unwrap();
            assert!(link.symlink && link.kind == EntryKind::Directory);
            let outside = entries.iter().find(|e| e.name == "outside").unwrap();
            assert!(outside.symlink && outside.kind == EntryKind::Other);
        }
        let _ = fs::remove_dir_all(&root);
    }
}
