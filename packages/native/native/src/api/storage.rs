use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use napi::Env;
use napi::bindgen_prelude::{AsyncTask, Buffer, Error, Result, Status, Task};
use napi_derive::napi;

use crate::storage::{ScanBatch, ToolCallScanner};

#[napi(object)]
pub struct NativeToolCallScanFile {
    pub conversation_id: String,
    pub tool_call_id: String,
    pub bytes: Buffer,
}

#[napi(object)]
pub struct NativeToolCallScanBatch {
    pub files: Vec<NativeToolCallScanFile>,
    pub bytes: i64,
    pub done: bool,
}

#[napi]
pub struct NativeToolCallScanner {
    scanner: Arc<Mutex<ToolCallScanner>>,
}

#[napi]
impl NativeToolCallScanner {
    #[napi(constructor)]
    pub fn new(home: String) -> Self {
        Self {
            scanner: Arc::new(Mutex::new(ToolCallScanner::new(PathBuf::from(home)))),
        }
    }

    #[napi]
    pub fn next_batch(&self, max_files: u32, max_bytes: u32) -> AsyncTask<ToolCallScanTask> {
        AsyncTask::new(ToolCallScanTask {
            scanner: Arc::clone(&self.scanner),
            max_files: max_files as usize,
            max_bytes: max_bytes as usize,
        })
    }
}

pub struct ToolCallScanTask {
    scanner: Arc<Mutex<ToolCallScanner>>,
    max_files: usize,
    max_bytes: usize,
}

impl Task for ToolCallScanTask {
    type Output = ScanBatch;
    type JsValue = NativeToolCallScanBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut scanner = self
            .scanner
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "tool-call scanner lock poisoned"))?;
        scanner
            .next_batch(self.max_files, self.max_bytes)
            .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeToolCallScanBatch {
            files: output
                .files
                .into_iter()
                .map(|file| NativeToolCallScanFile {
                    conversation_id: file.conversation_id,
                    tool_call_id: file.tool_call_id,
                    bytes: file.bytes.into(),
                })
                .collect(),
            bytes: output.bytes as i64,
            done: output.done,
        })
    }
}
