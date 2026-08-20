use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct ScanFile {
    pub conversation_id: String,
    pub tool_call_id: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct ScanBatch {
    pub files: Vec<ScanFile>,
    pub bytes: u64,
    pub done: bool,
}

#[derive(Debug)]
struct FileIdentity {
    conversation_id: String,
    tool_call_id: String,
    path: PathBuf,
}

#[derive(Debug)]
pub struct ToolCallScanner {
    home: PathBuf,
    files: Option<Vec<FileIdentity>>,
    cursor: usize,
}

impl ToolCallScanner {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            files: None,
            cursor: 0,
        }
    }

    pub fn next_batch(&mut self, max_files: usize, max_bytes: usize) -> io::Result<ScanBatch> {
        if max_files == 0 || max_bytes == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "scan batch limits must be positive",
            ));
        }
        if self.files.is_none() {
            self.files = Some(enumerate(&self.home)?);
        }
        let files = self.files.as_ref().expect("scanner files initialized");
        let mut batch = Vec::new();
        let mut bytes = 0usize;
        while self.cursor < files.len() && batch.len() < max_files {
            let identity = &files[self.cursor];
            let content = fs::read(&identity.path)?;
            if !batch.is_empty() && bytes.saturating_add(content.len()) > max_bytes {
                break;
            }
            bytes = bytes.saturating_add(content.len());
            batch.push(ScanFile {
                conversation_id: identity.conversation_id.clone(),
                tool_call_id: identity.tool_call_id.clone(),
                bytes: content,
            });
            self.cursor += 1;
        }
        Ok(ScanBatch {
            files: batch,
            bytes: bytes as u64,
            done: self.cursor >= files.len(),
        })
    }
}

fn enumerate(home: &Path) -> io::Result<Vec<FileIdentity>> {
    let conversations = home.join("conversations");
    let mut conversation_entries = read_dir_or_empty(&conversations)?;
    conversation_entries.sort_by_key(|entry| entry.file_name());
    let mut files = Vec::new();
    for conversation in conversation_entries {
        if !conversation.file_type()?.is_dir() {
            continue;
        }
        let conversation_id = conversation.file_name().to_string_lossy().into_owned();
        if !valid_id(&conversation_id, "conv_") {
            continue;
        }
        let directory = conversation.path().join("tool-calls");
        let mut entries = read_dir_or_empty(&directory)?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".json") {
                continue;
            }
            let tool_call_id = name.trim_end_matches(".json").to_string();
            if !valid_id(&tool_call_id, "tool_") {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid canonical tool-call filename '{name}'"),
                ));
            }
            files.push(FileIdentity {
                conversation_id: conversation_id.clone(),
                tool_call_id,
                path: entry.path(),
            });
        }
    }
    Ok(files)
}

fn read_dir_or_empty(path: &Path) -> io::Result<Vec<fs::DirEntry>> {
    match fs::read_dir(path) {
        Ok(entries) => entries.collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn valid_id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scans_deterministically_in_bounded_batches() {
        let root = std::env::temp_dir().join(format!(
            "nerve-native-scan-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let dir = root.join("conversations/conv_b/tool-calls");
        fs::create_dir_all(&dir).expect("create fixture");
        fs::write(dir.join("tool_b.json"), b"bb").expect("write fixture");
        fs::write(dir.join("tool_a.json"), b"a").expect("write fixture");
        let mut scanner = ToolCallScanner::new(root.clone());
        let first = scanner.next_batch(1, 10).expect("first batch");
        assert_eq!(first.files[0].tool_call_id, "tool_a");
        assert!(!first.done);
        let second = scanner.next_batch(10, 10).expect("second batch");
        assert_eq!(second.files[0].tool_call_id, "tool_b");
        assert!(second.done);
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
