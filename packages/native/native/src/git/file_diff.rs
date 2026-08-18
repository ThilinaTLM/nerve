use std::path::{Component, Path};

use gix::bstr::ByteSlice;

use super::error::{ErrorKind, GitReadError};
use super::model::{DocumentSource, DocumentSourceKind, FileDiff, FileDocument};

const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;

pub fn read(
    repo_path: &str,
    original: DocumentSource,
    modified: DocumentSource,
) -> Result<FileDiff, GitReadError> {
    let repo =
        gix::open(repo_path).map_err(|error| GitReadError::from_gix("open repository", error))?;
    Ok(FileDiff {
        original: read_source(&repo, original)?,
        modified: read_source(&repo, modified)?,
    })
}

fn read_source(
    repo: &gix::Repository,
    source: DocumentSource,
) -> Result<FileDocument, GitReadError> {
    validate_relative_path(&source.path)?;
    let bytes = match source.kind {
        DocumentSourceKind::Empty => Vec::new(),
        DocumentSourceKind::Revision(revision) => {
            let commit = repo
                .rev_parse_single(revision.as_str())
                .map_err(|error| GitReadError::from_gix("resolve document revision", error))?
                .object()
                .map_err(|error| GitReadError::from_gix("read document revision", error))?
                .peel_to_commit()
                .map_err(|error| GitReadError::from_gix("peel document revision", error))?;
            let tree = commit
                .tree()
                .map_err(|error| GitReadError::from_gix("read revision tree", error))?;
            let entry = tree
                .lookup_entry_by_path(&source.path)
                .map_err(|error| GitReadError::from_gix("lookup revision path", error))?
                .ok_or_else(|| {
                    GitReadError::new(
                        ErrorKind::NotFound,
                        format!("path '{}' was not found", source.path),
                    )
                })?;
            entry
                .object()
                .map_err(|error| GitReadError::from_gix("read revision path object", error))?
                .try_into_blob()
                .map_err(|error| GitReadError::from_gix("revision path is not a blob", error))?
                .data
                .clone()
        }
        DocumentSourceKind::Index => {
            let index = repo
                .index()
                .map_err(|error| GitReadError::from_gix("read index", error))?;
            let entry = index
                .entry_by_path(source.path.as_bytes().as_bstr())
                .ok_or_else(|| {
                    GitReadError::new(
                        ErrorKind::NotFound,
                        format!("path '{}' was not found in the index", source.path),
                    )
                })?;
            repo.find_object(entry.id)
                .map_err(|error| GitReadError::from_gix("read index blob", error))?
                .try_into_blob()
                .map_err(|error| GitReadError::from_gix("index path is not a blob", error))?
                .data
                .clone()
        }
        DocumentSourceKind::Worktree => {
            let workdir = repo.workdir().ok_or_else(|| {
                GitReadError::new(
                    ErrorKind::Unsupported,
                    "bare repositories do not have worktree documents",
                )
            })?;
            let root = workdir
                .canonicalize()
                .map_err(|error| GitReadError::from_gix("resolve worktree", error))?;
            let target = workdir
                .join(&source.path)
                .canonicalize()
                .map_err(|error| GitReadError::from_gix("resolve worktree document", error))?;
            if !target.starts_with(&root) {
                return Err(GitReadError::new(
                    ErrorKind::InvalidInput,
                    "worktree document resolves outside the repository",
                ));
            }
            std::fs::read(target)
                .map_err(|error| GitReadError::from_gix("read worktree document", error))?
        }
    };
    document(bytes)
}

fn document(bytes: Vec<u8>) -> Result<FileDocument, GitReadError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(GitReadError::new(
            ErrorKind::LimitExceeded,
            format!("document exceeds {MAX_DOCUMENT_BYTES} bytes"),
        ));
    }
    let size = u32::try_from(bytes.len())
        .map_err(|_| GitReadError::new(ErrorKind::LimitExceeded, "document size exceeds u32"))?;
    if bytes.contains(&0) {
        return Ok(FileDocument {
            content: None,
            binary: true,
            size,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(FileDocument {
            content: Some(content),
            binary: false,
            size,
        }),
        Err(_) => Ok(FileDocument {
            content: None,
            binary: true,
            size,
        }),
    }
}

fn validate_relative_path(path: &str) -> Result<(), GitReadError> {
    let path = Path::new(path);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(GitReadError::new(
            ErrorKind::InvalidInput,
            "document path must be a contained repository-relative path",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{document, validate_relative_path};

    #[test]
    fn classifies_text_and_binary_documents() {
        let text = document(b"hello\n".to_vec()).unwrap();
        assert_eq!(text.content.as_deref(), Some("hello\n"));
        assert!(!text.binary);

        let binary = document(vec![0, 1, 2]).unwrap();
        assert!(binary.content.is_none());
        assert!(binary.binary);
    }

    #[test]
    fn rejects_uncontained_paths() {
        assert!(validate_relative_path("src/file.ts").is_ok());
        assert!(validate_relative_path("../outside").is_err());
        assert!(validate_relative_path("/absolute").is_err());
    }
}
