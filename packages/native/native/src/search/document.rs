use super::{Candidate, Query, Term, Text, TextMatchKind, cancelled, merge_in_place, rank, text};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;

type Result<T> = std::result::Result<T, &'static str>;
pub const MAX_SOURCE_UNITS: usize = 64 * 1024 * 1024;
pub const MAX_TYPED_DOCUMENTS: usize = 200_000;
pub const MAX_CHANGES: usize = 400_000;
pub const MAX_FIELDS: usize = 400_000;
pub const MAX_RECORDS: usize = 2_000_000;
pub const MAX_DOCUMENT_TEXT: usize = 65536;

#[derive(Default)]
pub struct PathInput {
    pub lower: Option<Text>,
    pub name_lower: Option<Text>,
    pub stem_lower: Option<Text>,
    pub segments_lower: Option<Vec<Text>>,
}

impl Candidate {
    pub fn compact(path: Text, directory: bool, input: PathInput) -> Result<Self> {
        let path_lower = input
            .lower
            .filter(|lower| *lower != path)
            .unwrap_or_else(|| path.ascii_lower());
        let segments = path.split_path();
        let segments_lower = input
            .segments_lower
            .unwrap_or_else(|| path_lower.split_path());
        let name = {
            segments
                .last()
                .cloned()
                .unwrap_or_else(|| Vec::new().into())
        };
        let name_lower = input.name_lower.unwrap_or_else(|| {
            segments_lower
                .last()
                .cloned()
                .unwrap_or_else(|| Vec::new().into())
        });
        let stem = derive_stem(&name, directory);
        let stem_lower = input
            .stem_lower
            .unwrap_or_else(|| derive_stem(&name_lower, directory));
        if name.len() > path.len() || segments.len() != segments_lower.len() {
            return Err("Invalid completion candidate");
        }
        Ok(Self {
            path,
            path_lower,
            name,
            name_lower,
            stem,
            stem_lower,
            depth: segments.len() as u32,
            segments,
            segments_lower,
            directory,
        })
    }
}
fn derive_stem(name: &Text, directory: bool) -> Text {
    if !directory && let Some(at) = name.iter().rposition(|c| *c == 46) {
        name.slice(0..at)
    } else {
        name.clone()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKey {
    Path,
    Name,
    Title,
    Identifier,
    Description,
}
impl FieldKey {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "path" => Ok(Self::Path),
            "name" => Ok(Self::Name),
            "title" => Ok(Self::Title),
            "identifier" => Ok(Self::Identifier),
            "description" => Ok(Self::Description),
            _ => Err("Invalid search field key"),
        }
    }
    // Shared score bands; no kind-specific policy. See README for exact calibration.
    fn weight(self) -> f64 {
        match self {
            Self::Path | Self::Name | Self::Identifier => 1.,
            Self::Title => 0.95,
            Self::Description => 0.75,
        }
    }
}
/// Query normalization is request-local, never reconstructed inside the document loop.
fn normalized_query(q: &Query) -> Option<Query> {
    if q.aligned.is_none() && q.terms.iter().all(|term| term.aligned.is_none()) {
        return None;
    }
    Some(Query {
        value: q.aligned.as_ref().unwrap_or(&q.value).clone(),
        lower: q.lower.clone(),
        path: q.path.clone(),
        folder: q.folder,
        ordered: q.ordered,
        aligned: None,
        terms: q
            .terms
            .iter()
            .map(|term| Term {
                value: term.aligned.as_ref().unwrap_or(&term.value).clone(),
                lower: term.lower.clone(),
                aligned: None,
            })
            .collect(),
    })
}
#[derive(Clone, Copy)]
struct QueryViews<'a> {
    source: &'a Query,
    normalized: Option<&'a Query>,
}
impl QueryViews<'_> {
    fn normalized(&self) -> &Query {
        self.normalized.unwrap_or(self.source)
    }
}
struct PreparedTerm {
    source: Query,
    normalized: Option<Query>,
}
impl PreparedTerm {
    fn views(&self) -> QueryViews<'_> {
        QueryViews {
            source: &self.source,
            normalized: self.normalized.as_ref(),
        }
    }
    fn term(&self) -> &Term {
        &self.normalized.as_ref().unwrap_or(&self.source).terms[0]
    }
}
struct PreparedQuery<'a> {
    source: &'a Query,
    normalized: Option<Query>,
    terms: Vec<PreparedTerm>,
    whole: Term,
}
impl<'a> PreparedQuery<'a> {
    fn new(q: &'a Query) -> Self {
        let terms = q
            .terms
            .iter()
            .map(|term| {
                let source = Query {
                    aligned: term.aligned.clone(),
                    value: term.value.clone(),
                    lower: term.lower.clone(),
                    path: term.lower.clone(),
                    folder: false,
                    ordered: false,
                    terms: vec![term.clone()],
                };
                let normalized = normalized_query(&source);
                PreparedTerm { source, normalized }
            })
            .collect();
        Self {
            source: q,
            normalized: normalized_query(q),
            terms,
            whole: Term {
                value: q.aligned.as_ref().unwrap_or(&q.value).clone(),
                lower: q.lower.clone(),
                aligned: None,
            },
        }
    }
    fn views(&self) -> QueryViews<'_> {
        QueryViews {
            source: self.source,
            normalized: self.normalized.as_ref(),
        }
    }
}

pub struct Alignment {
    pub value: Text,
    pub spans: Vec<[u32; 4]>,
    pub cached_path: Option<Box<Candidate>>,
}
impl Alignment {
    fn map_range(&self, range: &mut [u32; 2]) {
        let boundary = |index: u32, end: bool| {
            let mut delta = 0i64;
            for [original, normalized, old_width, new_width] in &self.spans {
                if index < *normalized {
                    break;
                }
                if index == *normalized {
                    return *original;
                }
                if index < normalized + new_width {
                    return if end { original + old_width } else { *original };
                }
                delta = (normalized + new_width) as i64 - (original + old_width) as i64;
            }
            (index as i64 - delta).max(0) as u32
        };
        *range = [boundary(range[0], false), boundary(range[1], true)];
    }
}
pub enum Field {
    Path {
        candidate: Candidate,
        alignment: Option<Box<Alignment>>,
        source_length: usize,
    },
    Text {
        key: FieldKey,
        value: Text,
        lower: Text,
        alignment: Option<Box<Alignment>>,
    },
}
fn aligned_candidate(candidate: &Candidate, alignment: &Alignment) -> Result<Candidate> {
    Candidate::compact(
        alignment.value.clone(),
        candidate.directory,
        PathInput {
            lower: Some(candidate.path_lower.clone()),
            name_lower: Some(candidate.name_lower.clone()),
            stem_lower: Some(candidate.stem_lower.clone()),
            segments_lower: Some(candidate.segments_lower.clone()),
        },
    )
}
impl Field {
    fn source_units(&self) -> usize {
        match self {
            Self::Path { source_length, .. } => *source_length,
            Self::Text { value, .. } => value.len(),
        }
    }
    fn raw_path_match(
        &self,
        q: QueryViews<'_>,
        closed: &AtomicBool,
    ) -> Result<Option<(f64, Vec<[u32; 2]>)>> {
        let Self::Path {
            candidate,
            alignment,
            ..
        } = self
        else {
            unreachable!()
        };
        if alignment.is_none() && q.normalized.is_none() {
            return rank(candidate, q.source, closed);
        }
        let temporary = match alignment {
            Some(alignment) if alignment.cached_path.is_none() => {
                Some(aligned_candidate(candidate, alignment)?)
            }
            _ => None,
        };
        let aligned = alignment
            .as_ref()
            .and_then(|a| a.cached_path.as_deref())
            .or(temporary.as_ref())
            .unwrap_or(candidate);
        let Some((score, ranges)) = rank(aligned, q.normalized(), closed)? else {
            return Ok(None);
        };
        let score = rank(candidate, q.source, closed)?.map_or(score, |matched| matched.0);
        Ok(Some((score, ranges)))
    }
    #[cfg(test)]
    fn path_match(&self, q: &Query, closed: &AtomicBool) -> Result<Option<(f64, Vec<[u32; 2]>)>> {
        let prepared = PreparedQuery::new(q);
        Ok(self
            .raw_path_match(prepared.views(), closed)?
            .map(|(score, mut ranges)| {
                self.remap_ranges(&mut ranges);
                (score, ranges)
            }))
    }
    fn remap_ranges(&self, ranges: &mut Vec<[u32; 2]>) {
        let (alignment, length) = match self {
            Self::Path {
                alignment,
                source_length,
                ..
            } => (alignment, *source_length),
            Self::Text {
                alignment, value, ..
            } => (alignment, value.len()),
        };
        ranges.retain_mut(|range| {
            if let Some(alignment) = alignment {
                alignment.map_range(range);
            }
            range[0] = (range[0] as usize).min(length) as u32;
            range[1] = (range[1] as usize).min(length) as u32;
            range[0] < range[1]
        });
        merge_in_place(ranges);
    }
    pub fn records(&self) -> usize {
        match self {
            Self::Path {
                candidate,
                alignment,
                ..
            } => 1 + candidate.segments.len() * 2 + alignment.as_ref().map_or(0, |a| a.spans.len()),
            Self::Text { alignment, .. } => 1 + alignment.as_ref().map_or(0, |a| a.spans.len()),
        }
    }
    fn cache_records(&self) -> usize {
        match self {
            Self::Path {
                alignment: Some(alignment),
                ..
            } => alignment
                .cached_path
                .as_ref()
                .map_or(0, |c| 1 + c.segments.len() * 2),
            _ => 0,
        }
    }
    fn clear_cache(&mut self) {
        if let Self::Path {
            alignment: Some(alignment),
            ..
        } = self
        {
            alignment.cached_path = None;
        }
    }
    fn prepare_cache(&mut self, remaining: usize) -> usize {
        let Self::Path {
            candidate,
            alignment: Some(alignment),
            ..
        } = self
        else {
            return 0;
        };
        let cost = 1 + candidate.segments.len() * 2;
        if cost <= remaining
            && let Ok(cached) = aligned_candidate(candidate, alignment)
        {
            alignment.cached_path = Some(Box::new(cached));
            return cost;
        }
        0
    }
    fn term(
        &self,
        prepared: &PreparedTerm,
        closed: &AtomicBool,
    ) -> Result<Option<(f64, Vec<[u32; 2]>)>> {
        match self {
            Self::Path { .. } => self.raw_path_match(prepared.views(), closed),
            _ => self.text_match(prepared.term(), closed),
        }
    }
    fn text_match(&self, term: &Term, closed: &AtomicBool) -> Result<Option<(f64, Vec<[u32; 2]>)>> {
        let Self::Text {
            key,
            value,
            lower,
            alignment,
        } = self
        else {
            unreachable!()
        };
        let normalized_value = alignment.as_ref().map_or(value, |a| &a.value);
        Ok(text(term, normalized_value, lower, closed)?.map(|m| {
            let calibrated = match m.kind {
                TextMatchKind::Exact | TextMatchKind::Prefix => m.score * 5.,
                TextMatchKind::Substring => m.score.clamp(1800., 2800.) * 5.,
                TextMatchKind::Fuzzy => {
                    3000. + (m.score / term.value.len().max(1) as f64 * 12.).clamp(0., 9000.)
                }
            };
            (calibrated * key.weight(), m.ranges)
        }))
    }
}
pub struct Document {
    pub id: Vec<u16>,
    pub kind: Vec<u16>,
    pub fields: Vec<Field>,
}
impl Document {
    fn source_units(&self) -> usize {
        self.id.len() + self.kind.len() + self.fields.iter().map(Field::source_units).sum::<usize>()
    }
    pub fn records(&self) -> usize {
        1 + self.fields.iter().map(Field::records).sum::<usize>()
    }
    fn cache_records(&self) -> usize {
        self.fields.iter().map(Field::cache_records).sum()
    }
    fn clear_cache(&mut self) {
        for field in &mut self.fields {
            field.clear_cache();
        }
    }
    fn validate(&self) -> Result<()> {
        if self.id.is_empty()
            || self.id.len() > 1024
            || self.kind.is_empty()
            || self.kind.len() > 128
            || self.fields.is_empty()
            || self.fields.len() > 32
        {
            return Err("Invalid search document");
        }
        let units = self.fields.iter().map(Field::source_units).sum::<usize>();
        if units == 0 || units > MAX_DOCUMENT_TEXT {
            return Err("Search document text must be 1 to 65536 UTF-16 units");
        }
        Ok(())
    }
}
#[derive(Debug)]
pub struct FieldMatch {
    pub field_index: u32,
    pub ranges: Vec<[u32; 2]>,
    pub score: f64,
}
#[derive(Debug)]
pub struct Item {
    pub id: Vec<u16>,
    pub lexical_score: f64,
    pub matches: Vec<FieldMatch>,
}
enum MatchSet {
    Single(FieldMatch),
    Many(Vec<FieldMatch>),
}
impl MatchSet {
    fn add(self, mut matched: FieldMatch) -> Self {
        match self {
            Self::Single(mut existing) if existing.field_index == matched.field_index => {
                existing.ranges.append(&mut matched.ranges);
                existing.score += matched.score;
                Self::Single(existing)
            }
            Self::Single(existing) => Self::Many(vec![existing, matched]),
            Self::Many(mut matches) => {
                if let Some(existing) = matches
                    .iter_mut()
                    .find(|m| m.field_index == matched.field_index)
                {
                    existing.ranges.append(&mut matched.ranges);
                    existing.score += matched.score;
                } else {
                    matches.push(matched);
                }
                Self::Many(matches)
            }
        }
    }
    fn normalize(&mut self, count: usize) {
        match self {
            Self::Single(matched) => matched.score /= count as f64,
            Self::Many(matches) => {
                for matched in matches.iter_mut() {
                    matched.score /= count as f64;
                }
                matches.sort_by_key(|m| m.field_index);
            }
        }
    }
}
struct Ranked {
    lexical_score: f64,
    matches: MatchSet,
}
impl Ranked {
    fn materialize(self, document: &Document) -> Item {
        let mut matches = match self.matches {
            MatchSet::Single(matched) => vec![matched],
            MatchSet::Many(matches) => matches,
        };
        for matched in &mut matches {
            document.fields[matched.field_index as usize].remap_ranges(&mut matched.ranges);
        }
        Item {
            id: document.id.clone(),
            lexical_score: self.lexical_score,
            matches,
        }
    }
}
pub struct QueryResult {
    pub revision: u32,
    pub items: Vec<Item>,
}

#[derive(Default)]
pub struct Engine {
    documents: Vec<Document>,
    positions: HashMap<Vec<u16>, usize>,
    staged: Vec<Document>,
    staged_units: usize,
    staged_fields: usize,
    staged_records: usize,
    fields: usize,
    records: usize,
    cache_records: usize,
    staged_remove: Vec<Vec<u16>>,
    source_units: usize,
    revision: u32,
}
impl Engine {
    fn document(&self, id: &[u16]) -> Option<&Document> {
        self.positions
            .get(id)
            .map(|position| &self.documents[*position])
    }
    fn remove_document(&mut self, id: &[u16]) {
        if let Some(position) = self.positions.remove(id) {
            self.documents.swap_remove(position);
            if position < self.documents.len() {
                *self
                    .positions
                    .get_mut(&self.documents[position].id)
                    .unwrap() = position;
            }
        }
    }
    fn insert_document(&mut self, document: Document) {
        if let Some(position) = self.positions.get(&document.id) {
            self.documents[*position] = document;
        } else {
            self.positions
                .insert(document.id.clone(), self.documents.len());
            self.documents.push(document);
        }
    }

    pub fn stage(
        &mut self,
        documents: Vec<Document>,
        remove: Vec<Vec<u16>>,
        closed: &AtomicBool,
    ) -> Result<()> {
        for document in &documents {
            cancelled(closed)?;
            document.validate()?;
        }
        let units = documents.iter().map(Document::source_units).sum::<usize>()
            + remove.iter().map(Vec::len).sum::<usize>();
        let fields = documents.iter().map(|d| d.fields.len()).sum::<usize>();
        let records = documents.iter().map(Document::records).sum::<usize>() + remove.len();
        if self.staged.len() + documents.len() > MAX_TYPED_DOCUMENTS
            || self.staged_remove.len() + remove.len() > MAX_TYPED_DOCUMENTS
            || self.staged.len() + self.staged_remove.len() + documents.len() + remove.len()
                > MAX_CHANGES
            || self.staged_units + units > MAX_SOURCE_UNITS
        {
            return Err("Search update source/count bound exceeded");
        }
        if self.staged_fields + fields > MAX_FIELDS || self.staged_records + records > MAX_RECORDS {
            return Err("Search update structural budget exceeded");
        }
        cancelled(closed)?;
        self.staged.extend(documents);
        self.staged_remove.extend(remove);
        self.staged_units += units;
        self.staged_fields += fields;
        self.staged_records += records;
        Ok(())
    }
    pub fn discard(&mut self) {
        self.staged = Vec::new();
        self.staged_remove = Vec::new();
        self.staged_units = 0;
        self.staged_fields = 0;
        self.staged_records = 0;
    }
    pub fn commit(&mut self, closed: &AtomicBool) -> Result<u32> {
        let mut ids = HashSet::new();
        let mut units = self.source_units;
        let mut count = self.documents.len();
        let mut fields = self.fields;
        let mut records = self.records;
        let mut cached_records = self.cache_records;
        let mut changed = !self.staged.is_empty();
        for id in &self.staged_remove {
            cancelled(closed)?;
            if ids.insert(id.as_slice())
                && let Some(old) = self.document(id)
            {
                units -= old.source_units();
                fields -= old.fields.len();
                records -= old.records();
                cached_records -= old.cache_records();
                count -= 1;
                changed = true;
            }
        }
        let mut upserts = HashSet::new();
        for document in &self.staged {
            cancelled(closed)?;
            if !upserts.insert(document.id.as_slice()) {
                return Err("Duplicate search document id in update");
            }
            if !ids.contains(document.id.as_slice())
                && let Some(old) = self.document(&document.id)
            {
                units -= old.source_units();
                fields -= old.fields.len();
                records -= old.records();
                cached_records -= old.cache_records();
                count -= 1;
            }
            units += document.source_units();
            fields += document.fields.len();
            records += document.records();
            count += 1;
        }
        if count > MAX_TYPED_DOCUMENTS || units > MAX_SOURCE_UNITS {
            return Err("Search index source bound exceeded");
        }
        if fields > MAX_FIELDS || records > MAX_RECORDS {
            return Err("Search index structural budget exceeded");
        }
        cancelled(closed)?;
        if !changed {
            self.discard();
            return Ok(self.revision);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or("Search revision exhausted")?;
        cancelled(closed)?;
        // Caches are optional: never reject a previously valid update to keep one.
        // Both retained and staged structures stay within the existing record cap.
        drop(ids);
        drop(upserts);
        let retained_headroom = MAX_RECORDS - records;
        let clear_existing_cache = cached_records > retained_headroom;
        if clear_existing_cache {
            cached_records = 0;
        }
        let incoming_headroom =
            (retained_headroom - cached_records).min(MAX_RECORDS - self.staged_records);
        let prepared_cache = (|| {
            let mut added = 0;
            for document in &mut self.staged {
                cancelled(closed)?;
                document.clear_cache();
                for field in &mut document.fields {
                    cancelled(closed)?;
                    added += field.prepare_cache(incoming_headroom - added);
                }
            }
            cancelled(closed)?;
            Ok(added)
        })();
        let added_cache = match prepared_cache {
            Ok(added) => added,
            Err(error) => {
                for document in &mut self.staged {
                    document.clear_cache();
                }
                return Err(error);
            }
        };
        // No cancellation/fallible validation once publication starts. Queries hold the same
        // worker-side mutex, so no observer can see a partially published revision.
        if clear_existing_cache {
            for document in self.documents.iter_mut() {
                document.clear_cache();
            }
        }
        for id in std::mem::take(&mut self.staged_remove) {
            self.remove_document(&id);
        }
        for document in std::mem::take(&mut self.staged) {
            self.insert_document(document);
        }
        self.staged_units = 0;
        self.source_units = units;
        self.staged_fields = 0;
        self.staged_records = 0;
        self.fields = fields;
        self.records = records;
        self.cache_records = cached_records + added_cache;
        self.revision = revision;
        Ok(revision)
    }
    pub fn query<'a>(
        &'a self,
        q: &Query,
        kinds: Option<&[Vec<u16>]>,
        document_ids: Option<&[Vec<u16>]>,
        limit: usize,
        closed: &AtomicBool,
    ) -> Result<QueryResult> {
        if document_ids.is_some_and(|ids| ids.len() > 256) {
            return Err("Search documentIds exceeds 256");
        }
        let mut retained: Vec<(&Document, usize, Ranked)> = Vec::with_capacity(limit);
        if q.terms.len() > 32 || limit == 0 {
            return Ok(QueryResult {
                revision: self.revision,
                items: vec![],
            });
        }
        let prepared = PreparedQuery::new(q);
        let mut consider = |document: &'a Document| -> Result<()> {
            cancelled(closed)?;
            if kinds.is_some_and(|ks| !ks.contains(&document.kind)) {
                return Ok(());
            }
            if let Some(ranked) = score(document, &prepared, closed)? {
                // A scalar sentinel for nonpath documents keeps mixed-kind comparisons
                // transitive. Multiple path fields use the shortest original UTF-16 length.
                let path_length = document
                    .fields
                    .iter()
                    .filter_map(|field| match field {
                        Field::Path { source_length, .. } => Some(*source_length),
                        _ => None,
                    })
                    .min()
                    .unwrap_or(usize::MAX);
                let at = retained.partition_point(|(other, other_length, matched)| {
                    matched
                        .lexical_score
                        .total_cmp(&ranked.lexical_score)
                        .reverse()
                        .then_with(|| other_length.cmp(&path_length))
                        .then_with(|| other.id.cmp(&document.id))
                        != std::cmp::Ordering::Greater
                });
                if at < limit {
                    if retained.len() == limit {
                        retained.pop();
                    }
                    retained.insert(at, (document, path_length, ranked));
                }
            }
            Ok(())
        };
        if let Some(ids) = document_ids {
            let mut seen = HashSet::with_capacity(ids.len());
            for id in ids {
                cancelled(closed)?;
                if seen.insert(id.as_slice())
                    && let Some(document) = self.document(id)
                {
                    consider(document)?;
                }
            }
        } else {
            // Keep the ordinary query on dense traversal: no filter set or lookup per document.
            for document in &self.documents {
                consider(document)?;
            }
        }
        let mut items = Vec::with_capacity(retained.len());
        for (document, _, ranked) in retained {
            cancelled(closed)?;
            items.push(ranked.materialize(document));
        }
        cancelled(closed)?;
        Ok(QueryResult {
            revision: self.revision,
            items,
        })
    }
}
fn score(
    document: &Document,
    prepared: &PreparedQuery<'_>,
    closed: &AtomicBool,
) -> Result<Option<Ranked>> {
    let q = prepared.source;
    if q.value.is_empty() {
        return Ok(Some(Ranked {
            lexical_score: 0.,
            matches: MatchSet::Many(vec![]),
        }));
    }
    if let [field @ Field::Path { .. }] = document.fields.as_slice() {
        return Ok(field
            .raw_path_match(prepared.views(), closed)?
            .map(|(score, ranges)| Ranked {
                lexical_score: score,
                matches: MatchSet::Single(FieldMatch {
                    field_index: 0,
                    ranges,
                    score,
                }),
            }));
    }
    let mut matches: Option<MatchSet> = None;
    let mut total = 0.;
    for term in &prepared.terms {
        let mut best: Option<(usize, f64, Vec<[u32; 2]>)> = None;
        for (i, field) in document.fields.iter().enumerate() {
            cancelled(closed)?;
            if let Some((score, ranges)) = field.term(term, closed)?
                && best.as_ref().is_none_or(|b| score > b.1)
            {
                best = Some((i, score, ranges));
            }
        }
        let Some((i, score, ranges)) = best else {
            return Ok(None);
        };
        total += score;
        let matched = FieldMatch {
            field_index: i as u32,
            ranges,
            score,
        };
        matches = Some(match matches {
            Some(matches) => matches.add(matched),
            None => MatchSet::Single(matched),
        });
    }
    if q.terms.is_empty() {
        return Ok(None);
    }
    let mut best_whole: Option<(usize, f64, Vec<[u32; 2]>)> = None;
    for (i, field) in document.fields.iter().enumerate() {
        let matched = match field {
            Field::Path { .. } => field.raw_path_match(prepared.views(), closed)?,
            _ => field.text_match(&prepared.whole, closed)?,
        };
        if let Some((score, ranges)) = matched
            && score > total / q.terms.len() as f64
            && best_whole.as_ref().is_none_or(|m| score > m.1)
        {
            best_whole = Some((i, score, ranges));
        }
    }
    if let Some((i, score, ranges)) = best_whole {
        return Ok(Some(Ranked {
            lexical_score: score,
            matches: MatchSet::Single(FieldMatch {
                field_index: i as u32,
                ranges,
                score,
            }),
        }));
    }
    let mut matches = matches.unwrap();
    matches.normalize(q.terms.len());
    Ok(Some(Ranked {
        lexical_score: total / q.terms.len() as f64,
        matches,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn units(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }
    fn field(key: FieldKey, s: &str) -> Field {
        Field::Text {
            key,
            value: units(s).into(),
            lower: units(&s.to_lowercase()).into(),
            alignment: None,
        }
    }
    fn doc(id: &str, fields: Vec<Field>) -> Document {
        Document {
            id: units(id),
            kind: units("opaque-kind"),
            fields,
        }
    }
    fn q(s: &str) -> Query {
        Query {
            aligned: None,
            value: units(s).into(),
            lower: units(&s.to_lowercase()).into(),
            path: units(s).into(),
            folder: false,
            ordered: false,
            terms: s
                .split_whitespace()
                .map(|t| Term {
                    aligned: None,
                    value: units(t).into(),
                    lower: units(&t.to_lowercase()).into(),
                })
                .collect(),
        }
    }
    #[test]
    fn typed_ties_use_shortest_path_then_id_with_a_nonpath_sentinel() {
        let flag = AtomicBool::new(false);
        let path = |value: &str| Field::Path {
            candidate: Candidate::compact(units(value).into(), false, PathInput::default())
                .unwrap(),
            alignment: None,
            source_length: value.len(),
        };
        let mut engine = Engine::default();
        engine
            .stage(
                vec![
                    doc("a:long", vec![path("long-directory/Composer.ts")]),
                    doc(
                        "x:multi",
                        vec![path("long-directory/Composer.ts"), path("x")],
                    ),
                    doc("z:short", vec![path("q/Composer.ts")]),
                    doc("b:short", vec![path("p/Composer.ts")]),
                    doc("0:text", vec![field(FieldKey::Name, "Composer.ts")]),
                ],
                vec![],
                &flag,
            )
            .unwrap();
        engine.commit(&flag).unwrap();
        let result = engine
            .query(&q("Composer.ts"), None, None, 64, &flag)
            .unwrap();
        let path_items: Vec<_> = result
            .items
            .iter()
            .filter(|item| item.id != units("0:text"))
            .collect();
        assert_eq!(
            path_items
                .iter()
                .map(|item| item.id.clone())
                .collect::<Vec<_>>(),
            vec![
                units("x:multi"),
                units("b:short"),
                units("z:short"),
                units("a:long")
            ]
        );
        assert!(
            path_items
                .windows(2)
                .all(|pair| pair[0].lexical_score == pair[1].lexical_score)
        );
        let empty = engine.query(&q(""), None, None, 64, &flag).unwrap();
        assert_eq!(
            empty
                .items
                .iter()
                .map(|item| item.id.clone())
                .collect::<Vec<_>>(),
            vec![
                units("x:multi"),
                units("b:short"),
                units("z:short"),
                units("a:long"),
                units("0:text")
            ]
        );
    }
    #[test]
    fn filtered_queries_deduplicate_ids_and_keep_match_kind_revision_and_limit_semantics() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        engine
            .stage(
                vec![
                    doc("a", vec![field(FieldKey::Name, "target")]),
                    doc("z", vec![field(FieldKey::Name, "other")]),
                ],
                vec![],
                &flag,
            )
            .unwrap();
        engine.commit(&flag).unwrap();
        let ids = vec![units("z"), units("missing"), units("a"), units("a")];
        let result = engine
            .query(&q("target"), None, Some(&ids), 64, &flag)
            .unwrap();
        assert_eq!(result.revision, 1);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, units("a"));
        assert!(
            engine
                .query(&q("target"), Some(&[]), Some(&ids), 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
        assert!(
            engine
                .query(&q("target"), None, Some(&[]), 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(
            engine
                .query(&q(""), None, Some(&ids), 1, &flag)
                .unwrap()
                .items
                .len(),
            1
        );
        assert!(
            engine
                .query(&q(""), None, Some(&vec![units("a"); 257]), 64, &flag)
                .is_err()
        );
    }
    #[test]
    fn complete_query_must_cover_identifier_and_title_not_just_one_strong_hit() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        engine
            .stage(
                vec![
                    doc(
                        "pr:full",
                        vec![
                            field(FieldKey::Identifier, "271"),
                            field(FieldKey::Title, "fix memory leak"),
                        ],
                    ),
                    doc(
                        "pr:partial-number",
                        vec![field(FieldKey::Identifier, "271")],
                    ),
                    doc("pr:partial-title", vec![field(FieldKey::Title, "fix")]),
                ],
                vec![],
                &flag,
            )
            .unwrap();
        assert!(
            engine
                .query(&q(""), None, None, 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(engine.commit(&flag), Ok(1));
        let result = engine.query(&q("271 fix"), None, None, 64, &flag).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, units("pr:full"));
        assert_eq!(result.items[0].matches[0].ranges, vec![[0, 3]]);
        assert_eq!(result.items[0].matches[1].ranges, vec![[0, 3]]);
        assert_eq!(
            result.items[0].matches.iter().map(|m| m.score).sum::<f64>(),
            result.items[0].lexical_score
        );
    }
    #[test]
    fn updates_replace_whole_documents_and_failed_commits_publish_nothing() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        engine
            .stage(
                vec![doc("x:1", vec![field(FieldKey::Name, "old")])],
                vec![],
                &flag,
            )
            .unwrap();
        engine.commit(&flag).unwrap();
        engine
            .stage(
                vec![
                    doc("x:1", vec![field(FieldKey::Name, "new")]),
                    doc("x:1", vec![field(FieldKey::Name, "duplicate")]),
                ],
                vec![],
                &flag,
            )
            .unwrap();
        assert!(engine.commit(&flag).is_err());
        assert_eq!(
            engine
                .query(&q("old"), None, None, 64, &flag)
                .unwrap()
                .revision,
            1
        );
        assert_eq!(
            engine
                .query(&q("old"), None, None, 64, &flag)
                .unwrap()
                .items
                .len(),
            1
        );
        engine.discard();
        engine
            .stage(
                vec![doc("x:1", vec![field(FieldKey::Title, "new")])],
                vec![],
                &flag,
            )
            .unwrap();
        assert_eq!(engine.commit(&flag), Ok(2));
        assert!(
            engine
                .query(&q("old"), None, None, 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(
            engine
                .query(&q("new"), None, None, 64, &flag)
                .unwrap()
                .items[0]
                .matches[0]
                .field_index,
            0
        );
        engine
            .stage(
                vec![],
                vec![units("x:1"), units("x:1"), units("missing")],
                &flag,
            )
            .unwrap();
        assert_eq!(engine.commit(&flag), Ok(3));
        engine.stage(vec![], vec![units("x:1")], &flag).unwrap();
        assert_eq!(engine.commit(&flag), Ok(3));
        assert!(
            engine
                .query(&q(""), None, None, 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
    }
    #[test]
    fn weights_ties_filters_and_candidate_pool_are_deterministic() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        let mut documents: Vec<_> = (0..100)
            .rev()
            .map(|i| {
                doc(
                    &format!("opaque:{i:03}"),
                    vec![field(FieldKey::Name, "same")],
                )
            })
            .collect();
        documents.push(doc("title:x", vec![field(FieldKey::Title, "same")]));
        documents.push(doc(
            "description:x",
            vec![field(FieldKey::Description, "same")],
        ));
        engine.stage(documents, vec![], &flag).unwrap();
        engine.commit(&flag).unwrap();
        let result = engine.query(&q("same"), None, None, 64, &flag).unwrap();
        assert_eq!(result.items.len(), 64);
        assert_eq!(result.items[0].id, units("opaque:000"));
        assert_eq!(result.items[63].id, units("opaque:063"));
        let all = engine.query(&q("same"), None, None, 256, &flag).unwrap();
        assert!(all.items[99].lexical_score > all.items[100].lexical_score);
        assert!(all.items[100].lexical_score > all.items[101].lexical_score);
        assert!(
            engine
                .query(&q("same"), Some(&[]), None, 64, &flag)
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(
            engine
                .query(&q("same"), Some(&[units("opaque-kind")]), None, 64, &flag)
                .unwrap()
                .items
                .len(),
            64
        );
    }
    #[test]
    fn cancelled_commit_and_revision_overflow_never_publish_staged_replacements() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        engine
            .stage(
                vec![doc("x:1", vec![field(FieldKey::Name, "new")])],
                vec![],
                &flag,
            )
            .unwrap();
        assert!(engine.commit(&AtomicBool::new(true)).is_err());
        assert_eq!(engine.revision, 0);
        assert!(engine.documents.is_empty());
        engine.revision = u32::MAX;
        assert!(engine.commit(&flag).is_err());
        assert!(engine.documents.is_empty());
        engine.discard();
        engine.staged_units = MAX_SOURCE_UNITS;
        assert!(
            engine
                .stage(
                    vec![doc("x:1", vec![field(FieldKey::Name, "duplicate")])],
                    vec![],
                    &flag
                )
                .is_err()
        );
    }
}

#[cfg(test)]
mod boundary_tests {
    use super::*;
    fn u(s: &str) -> Text {
        s.encode_utf16().collect()
    }
    fn document() -> Document {
        Document {
            id: vec![1],
            kind: vec![2],
            fields: vec![Field::Text {
                key: FieldKey::Name,
                value: u("x"),
                lower: u("x"),
                alignment: None,
            }],
        }
    }
    #[test]
    fn typed_path_maps_expanding_case_offsets_and_preserves_scores() {
        let candidate = Candidate::compact(
            u("src/İ.ts"),
            false,
            PathInput {
                lower: Some(u("src/i\u{307}.ts")),
                ..PathInput::default()
            },
        )
        .unwrap();
        let field = Field::Path {
            candidate,
            alignment: Some(Box::new(Alignment {
                value: u("src/İİ.ts"),
                spans: vec![[4, 4, 1, 2]],
                cached_path: None,
            })),
            source_length: 8,
        };
        let make_query = |text: &str, aligned: Option<&str>| Query {
            value: u(text),
            lower: u(&text.to_lowercase()),
            path: u(&text.to_lowercase()),
            aligned: aligned.map(u),
            folder: false,
            ordered: false,
            terms: vec![Term {
                value: u(text),
                lower: u(&text.to_lowercase()),
                aligned: aligned.map(u),
            }],
        };
        let flag = AtomicBool::new(false);
        assert_eq!(
            field
                .path_match(&make_query("ts", None), &flag)
                .unwrap()
                .unwrap()
                .1,
            vec![[6, 8]]
        );
        assert_eq!(
            field
                .path_match(&make_query("İ.t", Some("İİ.t")), &flag)
                .unwrap()
                .unwrap()
                .1,
            vec![[4, 7]]
        );
        let Field::Path { candidate, .. } = &field else {
            unreachable!()
        };
        assert_eq!(
            field
                .path_match(&make_query("ts", None), &flag)
                .unwrap()
                .unwrap()
                .0,
            rank(candidate, &make_query("ts", None), &flag)
                .unwrap()
                .unwrap()
                .0
        );
        assert_eq!(field.records(), 6); // Field + two original/lower segment views + one sparse span.
        let literal = Field::Path {
            candidate: Candidate::compact(u("src/i\u{307}.ts"), false, PathInput::default())
                .unwrap(),
            alignment: None,
            source_length: 9,
        };
        assert_eq!(
            literal
                .path_match(&make_query("İ.t", Some("İİ.t")), &flag)
                .unwrap()
                .unwrap()
                .1,
            vec![[4, 8]]
        );
    }
    #[test]
    fn native_structure_bounds_reject_before_publication_and_discard_resets_staging() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        let mut empty = document();
        empty.fields.clear();
        assert!(engine.stage(vec![empty], vec![], &flag).is_err());
        engine.staged_fields = MAX_FIELDS;
        assert!(engine.stage(vec![document()], vec![], &flag).is_err());
        engine.discard();
        engine.staged_records = MAX_RECORDS;
        assert!(engine.stage(vec![document()], vec![], &flag).is_err());
        engine.discard();
        engine.stage(vec![document()], vec![], &flag).unwrap();
        engine.records = MAX_RECORDS;
        assert!(engine.commit(&flag).is_err());
        assert_eq!(engine.revision, 0);
        assert!(engine.documents.is_empty());
        engine.records = 0;
        engine.discard();
        engine.stage(vec![document()], vec![], &flag).unwrap();
        assert_eq!(engine.commit(&flag), Ok(1));
        assert_eq!(engine.fields, 1);
        assert_eq!(engine.records, 2);
    }
}

#[cfg(test)]
mod optimization_tests {
    use super::*;
    fn u(value: &str) -> Text {
        value.encode_utf16().collect()
    }
    fn path() -> Field {
        Field::Path {
            candidate: Candidate::compact(
                u("src/İ.ts"),
                false,
                PathInput {
                    lower: Some(u("src/i\u{307}.ts")),
                    ..PathInput::default()
                },
            )
            .unwrap(),
            alignment: Some(Box::new(Alignment {
                value: u("src/İİ.ts"),
                spans: vec![[4, 4, 1, 2]],
                cached_path: None,
            })),
            source_length: 8,
        }
    }
    fn q() -> Query {
        Query {
            value: u("ts"),
            lower: u("ts"),
            path: u("ts"),
            aligned: None,
            folder: false,
            ordered: false,
            terms: vec![Term {
                value: u("ts"),
                lower: u("ts"),
                aligned: None,
            }],
        }
    }
    #[test]
    fn sparse_cache_reuses_the_same_matcher_and_is_optional_under_record_pressure() {
        let flag = AtomicBool::new(false);
        let mut field = path();
        let uncached = field.path_match(&q(), &flag).unwrap();
        assert_eq!(field.prepare_cache(0), 0);
        assert_eq!(field.prepare_cache(5), 5);
        assert_eq!(field.cache_records(), 5);
        assert_eq!(field.path_match(&q(), &flag).unwrap(), uncached);
        let mut engine = Engine::default();
        engine
            .stage(
                vec![Document {
                    id: vec![1],
                    kind: vec![2],
                    fields: vec![path()],
                }],
                vec![],
                &flag,
            )
            .unwrap();
        engine.commit(&flag).unwrap();
        assert_eq!(engine.cache_records, 5);
        // Abstract full-budget boundary without allocating millions of records.
        engine.records = MAX_RECORDS - 5;
        engine
            .stage(
                vec![Document {
                    id: vec![3],
                    kind: vec![2],
                    fields: vec![Field::Text {
                        key: FieldKey::Name,
                        value: u("x"),
                        lower: u("x"),
                        alignment: None,
                    }],
                }],
                vec![],
                &flag,
            )
            .unwrap();
        assert_eq!(engine.commit(&flag), Ok(2)); // Optional cache eviction must not reject the update.
        assert_eq!(engine.cache_records, 0);
        assert!(engine.records + engine.cache_records <= MAX_RECORDS);
        assert_eq!(
            engine.query(&q(), None, None, 64, &flag).unwrap().items[0].matches[0].ranges,
            vec![[6, 8]]
        );
    }
    #[test]
    fn range_mapping_reuses_its_buffer_and_matches_the_previous_canonical_union() {
        let field = path();
        let mut random = 7u32;
        for count in 0..128 {
            let mut ranges = Vec::with_capacity(128);
            for _ in 0..count {
                random = random.wrapping_mul(1664525).wrapping_add(1013904223);
                let start = random % 40;
                random = random.wrapping_mul(1664525).wrapping_add(1013904223);
                ranges.push([start, random % 40]);
            }
            let mut expected: Vec<[u32; 2]> = ranges
                .iter()
                .filter_map(|r| {
                    let mut mapped = *r;
                    if let Field::Path {
                        alignment: Some(alignment),
                        ..
                    } = &field
                    {
                        alignment.map_range(&mut mapped);
                    }
                    mapped[0] = mapped[0].min(8);
                    mapped[1] = mapped[1].min(8);
                    (mapped[0] < mapped[1]).then_some(mapped)
                })
                .collect();
            expected.sort();
            let mut reference: Vec<[u32; 2]> = vec![];
            for range in expected {
                if let Some(last) = reference.last_mut()
                    && range[0] <= last[1]
                {
                    last[1] = last[1].max(range[1]);
                    continue;
                }
                reference.push(range);
            }
            let pointer = ranges.as_ptr();
            field.remap_ranges(&mut ranges);
            assert_eq!(ranges, reference);
            assert_eq!(ranges.as_ptr(), pointer);
        }
    }
}

#[cfg(test)]
mod dense_store_tests {
    use super::*;
    fn doc(id: &str) -> Document {
        Document {
            id: id.encode_utf16().collect(),
            kind: vec![1],
            fields: vec![Field::Text {
                key: FieldKey::Name,
                value: vec![120].into(),
                lower: vec![120].into(),
                alignment: None,
            }],
        }
    }
    #[test]
    fn replacement_and_swap_removal_keep_positions_dense_under_churn() {
        let flag = AtomicBool::new(false);
        let mut engine = Engine::default();
        engine
            .stage(vec![doc("a"), doc("b"), doc("c")], vec![], &flag)
            .unwrap();
        engine.commit(&flag).unwrap();
        engine
            .stage(vec![doc("d"), doc("c")], vec![vec![98]], &flag)
            .unwrap();
        engine.commit(&flag).unwrap();
        for i in 0..200 {
            let removed = engine.documents[0].id.clone();
            engine
                .stage(vec![doc(&format!("id:{i}"))], vec![removed], &flag)
                .unwrap();
            engine.commit(&flag).unwrap();
            assert_eq!(engine.documents.len(), 3);
            assert_eq!(engine.positions.len(), 3);
            for (position, document) in engine.documents.iter().enumerate() {
                assert_eq!(engine.positions.get(&document.id), Some(&position));
            }
            let empty: Text = Vec::new().into();
            let query = Query {
                value: empty.clone(),
                lower: empty.clone(),
                path: empty,
                aligned: None,
                folder: false,
                ordered: false,
                terms: vec![],
            };
            let result = engine.query(&query, None, None, 64, &flag).unwrap();
            assert_eq!(result.items.len(), 3);
            assert!(result.items.windows(2).all(|pair| pair[0].id < pair[1].id));
        }
    }
}
