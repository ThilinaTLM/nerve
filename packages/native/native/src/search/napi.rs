use super::document::{
    Alignment, Document, Field, FieldKey, MAX_DOCUMENT_TEXT, MAX_FIELDS, MAX_RECORDS, PathInput,
    QueryResult,
};
use super::index::{Lease, State};
use super::{Candidate, Query, Term, Text};
use napi::bindgen_prelude::{AsyncTask, Result, Task, Utf16String};
use napi::{Env, Error};
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct NativeCompletionTerm {
    pub value: Utf16String,
    pub lower: Utf16String,
    pub aligned: Option<Utf16String>,
}
#[napi(object)]
pub struct NativeCompletionQuery {
    pub aligned: Option<Utf16String>,
    pub value: Utf16String,
    pub lower: Utf16String,
    pub path: Utf16String,
    pub folder: bool,
    pub ordered: bool,
    pub terms: Vec<NativeCompletionTerm>,
}
#[napi(object)]
pub struct NativeSearchField {
    pub key: String,
    pub text: Utf16String,
    pub lower: Option<Utf16String>,
    pub name_lower: Option<Utf16String>,
    pub stem_lower: Option<Utf16String>,
    pub segments_lower: Option<Vec<Utf16String>>,
    pub aligned: Option<Utf16String>,
    pub case_spans: Option<Vec<Vec<u32>>>,
}
#[napi(object)]
pub struct NativeSearchDocument {
    pub id: Utf16String,
    pub kind: Utf16String,
    pub fields: Vec<NativeSearchField>,
}
#[napi(object)]
pub struct NativeSearchFieldMatch {
    pub field_index: u32,
    pub ranges: Vec<Vec<u32>>,
    pub score: f64,
}
#[napi(object)]
pub struct NativeSearchItem {
    pub id: Utf16String,
    pub lexical_score: f64,
    pub matches: Vec<NativeSearchFieldMatch>,
}
#[napi(object)]
pub struct NativeSearchResult {
    pub revision: u32,
    pub items: Vec<NativeSearchItem>,
}

fn text(value: Utf16String) -> Text {
    value.to_vec().into()
}
fn optional(value: Option<Utf16String>) -> Option<Text> {
    value.map(text)
}
fn texts(values: Option<Vec<Utf16String>>) -> Option<Vec<Text>> {
    values.map(|vs| vs.into_iter().map(text).collect())
}
impl NativeSearchField {
    fn convert(self) -> std::result::Result<Field, &'static str> {
        let key = FieldKey::parse(&self.key)?;
        let source_length = self.text.len();
        if source_length > 65536 {
            return Err("Search field source exceeds 65536 UTF-16 units");
        }
        let value = text(self.text);
        let lower = optional(self.lower).unwrap_or_else(|| value.ascii_lower());
        let mut alignment = if let Some(aligned) = self.aligned {
            if self
                .case_spans
                .as_ref()
                .is_some_and(|spans| spans.len() > source_length)
            {
                return Err("Invalid search case spans");
            }
            let spans: std::result::Result<Vec<[u32; 4]>, _> = self
                .case_spans
                .unwrap_or_default()
                .into_iter()
                .map(|span| span.try_into())
                .collect();
            let spans = spans.map_err(|_| "Invalid search case spans")?;
            if aligned.len() != lower.len()
                || spans.iter().any(|s| {
                    s[0] as usize + s[2] as usize > value.len()
                        || s[1] as usize + s[3] as usize > aligned.len()
                })
            {
                return Err("Invalid search case spans");
            }
            Some(Box::new(Alignment {
                value: text(aligned),
                spans,
                cached_path: None,
            }))
        } else {
            None
        };
        if key == FieldKey::Path {
            let directory = value.last() == Some(&47);
            let trim = |value: Text| {
                let end = value.iter().rposition(|c| *c != 47).map_or(0, |i| i + 1);
                if directory {
                    value.slice(0..end)
                } else {
                    value
                }
            };
            if let Some(alignment) = &mut alignment {
                alignment.value = trim(alignment.value.clone());
            }
            Ok(Field::Path {
                candidate: Candidate::compact(
                    trim(value),
                    directory,
                    PathInput {
                        lower: Some(trim(lower)),
                        name_lower: optional(self.name_lower),
                        stem_lower: optional(self.stem_lower),
                        segments_lower: texts(self.segments_lower),
                    },
                )?,
                alignment,
                source_length,
            })
        } else {
            Ok(Field::Text {
                key,
                value,
                lower,
                alignment,
            })
        }
    }
}
impl NativeCompletionQuery {
    fn convert(self) -> Query {
        Query {
            aligned: optional(self.aligned),
            value: text(self.value),
            lower: text(self.lower),
            path: text(self.path),
            folder: self.folder,
            ordered: self.ordered,
            terms: self
                .terms
                .into_iter()
                .map(|t| Term {
                    value: text(t.value),
                    lower: text(t.lower),
                    aligned: optional(t.aligned),
                })
                .collect(),
        }
    }
}

/// One retained typed search engine.
#[napi]
pub struct NativeSearchIndex {
    state: Arc<State>,
}
impl Drop for NativeSearchIndex {
    fn drop(&mut self) {
        if self.state.is_closed() {
            return;
        }
        self.state.close();
        // Forgotten explicit close must not free a large graph on the Node thread.
        // This is fallback disposal, not an awaitable shutdown protocol.
        let state = self.state.clone();
        if let Ok(runtime) = crate::core::runtime::handle() {
            runtime.spawn_blocking(move || state.dispose());
        } else {
            std::thread::spawn(move || state.dispose());
        }
    }
}
#[napi]
impl NativeSearchIndex {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
        }
    }
    #[napi]
    pub fn stage(
        &self,
        documents: Vec<NativeSearchDocument>,
        remove: Vec<Utf16String>,
    ) -> Result<AsyncTask<SearchMutationTask>> {
        if documents.len() + remove.len() > 1024 {
            return Err(Error::from_reason("Search update batch exceeds 1024"));
        }
        self.mutation(Mutation::Stage(documents, remove))
    }
    #[napi]
    pub fn commit(&self) -> Result<AsyncTask<SearchMutationTask>> {
        self.mutation(Mutation::Commit)
    }
    #[napi]
    pub fn discard(&self) -> Result<AsyncTask<SearchMutationTask>> {
        self.mutation(Mutation::Discard)
    }
    #[napi]
    pub fn search(
        &self,
        query: NativeCompletionQuery,
        kinds: Option<Vec<Utf16String>>,
        limit: u32,
        document_ids: Option<Vec<Utf16String>>,
    ) -> Result<AsyncTask<SearchQueryTask>> {
        if limit > 256 {
            return Err(Error::from_reason("Search limit must be at most 256"));
        }
        if document_ids.as_ref().is_some_and(|ids| {
            ids.len() > 256 || ids.iter().any(|id| id.is_empty() || id.len() > 1024)
        }) {
            return Err(Error::from_reason(
                "Invalid search documentIds (maximum 256)",
            ));
        }
        Ok(AsyncTask::new(SearchQueryTask {
            document_ids: document_ids.map(|ids| ids.into_iter().map(|id| id.to_vec()).collect()),
            lease: self.state.acquire().map_err(Error::from_reason)?,
            query: query.convert(),
            kinds: kinds.map(|ks| ks.into_iter().map(|s| s.to_vec()).collect()),
            limit: limit as usize,
        }))
    }
    #[napi]
    pub fn close(&self) -> AsyncTask<CompletionCloseTask> {
        self.state.close();
        AsyncTask::new(CompletionCloseTask {
            state: self.state.clone(),
        })
    }
}
impl NativeSearchIndex {
    fn mutation(&self, mutation: Mutation) -> Result<AsyncTask<SearchMutationTask>> {
        Ok(AsyncTask::new(SearchMutationTask {
            lease: self.state.acquire().map_err(Error::from_reason)?,
            mutation: Some(mutation),
        }))
    }
}
impl Default for NativeSearchIndex {
    fn default() -> Self {
        Self::new()
    }
}

enum Mutation {
    Stage(Vec<NativeSearchDocument>, Vec<Utf16String>),
    Commit,
    Discard,
}
pub struct SearchMutationTask {
    lease: Lease,
    mutation: Option<Mutation>,
}
impl Task for SearchMutationTask {
    type Output = u32;
    type JsValue = u32;
    fn compute(&mut self) -> Result<u32> {
        match self.mutation.take().unwrap() {
            Mutation::Stage(documents, remove) => {
                let mut records = documents.len() + remove.len();
                let mut field_count = 0;
                let mut converted = Vec::with_capacity(documents.len());
                for document in documents {
                    self.lease.check().map_err(Error::from_reason)?;
                    if document.fields.is_empty()
                        || document.id.is_empty()
                        || document.id.len() > 1024
                        || document.kind.is_empty()
                        || document.kind.len() > 128
                        || document.fields.len() > 32
                    {
                        return Err(Error::from_reason("Invalid search document"));
                    }
                    field_count += document.fields.len();
                    if field_count > MAX_FIELDS {
                        return Err(Error::from_reason("Search update field budget exceeded"));
                    }
                    let mut units = 0;
                    let mut fields = Vec::with_capacity(document.fields.len());
                    for field in document.fields {
                        self.lease.check().map_err(Error::from_reason)?;
                        units += field.text.len();
                        if units > MAX_DOCUMENT_TEXT {
                            return Err(Error::from_reason(
                                "Search document text exceeds 65536 UTF-16 units",
                            ));
                        }
                        let field = field.convert().map_err(Error::from_reason)?;
                        records += field.records();
                        if records > MAX_RECORDS {
                            return Err(Error::from_reason(
                                "Search update structural budget exceeded",
                            ));
                        }
                        fields.push(field);
                    }
                    converted.push(Document {
                        id: document.id.to_vec(),
                        kind: document.kind.to_vec(),
                        fields,
                    });
                }
                self.lease
                    .stage(converted, remove.into_iter().map(|s| s.to_vec()).collect())
                    .map_err(Error::from_reason)?;
            }
            Mutation::Commit => return self.lease.commit().map_err(Error::from_reason),
            Mutation::Discard => self.lease.discard().map_err(Error::from_reason)?,
        }
        Ok(0)
    }
    fn resolve(&mut self, _env: Env, output: u32) -> Result<u32> {
        self.lease.check().map_err(Error::from_reason)?;
        Ok(output)
    }
}
pub struct CompletionCloseTask {
    state: Arc<State>,
}
impl Task for CompletionCloseTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        self.state.dispose();
        Ok(())
    }
    fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
        Ok(())
    }
}
pub struct SearchQueryTask {
    lease: Lease,
    query: Query,
    kinds: Option<Vec<Vec<u16>>>,
    document_ids: Option<Vec<Vec<u16>>>,
    limit: usize,
}
impl Task for SearchQueryTask {
    type Output = QueryResult;
    type JsValue = NativeSearchResult;
    fn compute(&mut self) -> Result<Self::Output> {
        self.lease
            .query_documents(
                &self.query,
                self.kinds.as_deref(),
                self.document_ids.as_deref(),
                self.limit,
            )
            .map_err(Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        self.lease.check().map_err(Error::from_reason)?;
        Ok(NativeSearchResult {
            revision: output.revision,
            items: output
                .items
                .into_iter()
                .map(|item| NativeSearchItem {
                    id: item.id.into(),
                    lexical_score: item.lexical_score,
                    matches: item
                        .matches
                        .into_iter()
                        .map(|m| NativeSearchFieldMatch {
                            field_index: m.field_index,
                            ranges: m.ranges.into_iter().map(Vec::from).collect(),
                            score: m.score,
                        })
                        .collect(),
                })
                .collect(),
        })
    }
}
