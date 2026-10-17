//! Retained completion ranking. All text is JavaScript UTF-16, cased/collated by the caller.
use std::cmp::Ordering;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

pub type Text = Vec<u16>;
#[derive(Clone, Debug)]
pub struct Candidate {
    pub path: Text,
    pub name: Text,
    pub stem: Text,
    pub path_lower: Text,
    pub name_lower: Text,
    pub stem_lower: Text,
    pub segments: Vec<Text>,
    pub segments_lower: Vec<Text>,
    pub depth: u32,
    pub directory: bool,
    pub locale_rank: u32,
}
#[derive(Clone, Debug)]
pub struct Term {
    pub value: Text,
    pub lower: Text,
}
#[derive(Clone, Debug)]
pub struct Query {
    pub value: Text,
    pub lower: Text,
    pub path: Text,
    pub folder: bool,
    pub ordered: bool,
    pub terms: Vec<Term>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Match {
    pub candidate_index: usize,
    pub score: f64,
    pub ranges: Vec<[u32; 2]>,
}
#[derive(Clone, Debug)]
struct Local {
    score: f64,
    ranges: Vec<[u32; 2]>,
    segment: usize,
}
fn cancelled(closed: &AtomicBool) -> Result<(), &'static str> {
    if closed.load(AtomicOrdering::Relaxed) {
        Err("Completion index is closed")
    } else {
        Ok(())
    }
}
fn boost(c: &Candidate, folder: bool) -> f64 {
    if folder {
        if c.directory { 500. } else { -150. }
    } else if c.directory {
        40.
    } else {
        180.
    }
}
fn empty(c: &Candidate) -> (f64, Vec<[u32; 2]>) {
    (
        1000. + if c.depth == 1 { 500. } else { 0. } + if c.directory { 350. } else { 150. }
            - c.depth as f64 * 40.
            - c.path.len() as f64 / 5.,
        vec![],
    )
}
fn find(h: &[u16], n: &[u16]) -> Option<usize> {
    if n.is_empty() {
        Some(0)
    } else {
        h.windows(n.len()).position(|w| w == n)
    }
}
fn whitespace(c: u16) -> bool {
    matches!(c, 9..=13 | 32 | 160 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn boundary(v: &[u16], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    let p = v.get(i - 1).copied().unwrap_or(0);
    let c = v.get(i).copied().unwrap_or(0);
    matches!(p, 45 | 95 | 46 | 47)
        || whitespace(p)
        || (((97..=122).contains(&p) || (48..=57).contains(&p)) && (65..=90).contains(&c))
        || ((65..=90).contains(&p) || (97..=122).contains(&p)) && (48..=57).contains(&c)
}
fn merge(mut ranges: Vec<[u32; 2]>) -> Vec<[u32; 2]> {
    ranges.sort();
    let mut out: Vec<[u32; 2]> = vec![];
    for r in ranges {
        if let Some(last) = out.last_mut()
            && r[0] <= last[1]
        {
            last[1] = last[1].max(r[1]);
            continue;
        }
        out.push(r);
    }
    out
}
fn fuzzy(
    t: &Term,
    v: &[u16],
    h: &[u16],
    closed: &AtomicBool,
) -> Result<Option<Local>, &'static str> {
    let n = t.value.len();
    let m = v.len();
    if n > m || m > 512 || n == 0 {
        return Ok(None);
    }
    // JS for-of iterates code points, but indexOf and its +1 cursor use code units.
    let mut from = 0;
    let mut i = 0;
    while i < t.lower.len() {
        cancelled(closed)?;
        let width = if (0xd800..=0xdbff).contains(&t.lower[i])
            && t.lower
                .get(i + 1)
                .is_some_and(|c| (0xdc00..=0xdfff).contains(c))
        {
            2
        } else {
            1
        };
        let Some(at) = find(&h[from.min(h.len())..], &t.lower[i..i + width]) else {
            return Ok(None);
        };
        from += at + 1;
        i += width;
    }
    let mut scores = vec![vec![f64::NEG_INFINITY; m]; n];
    let mut previous = vec![vec![0; m]; n];
    for col in 0..m {
        if t.lower.first() == h.get(col) {
            scores[0][col] = 420. + if boundary(v, col) { 260. } else { 0. } - col as f64 * 12.
                + if t.value[0] == v[col] { 25. } else { 0. };
        }
    }
    for row in 1..n {
        cancelled(closed)?;
        let mut gap = f64::NEG_INFINITY;
        let mut gap_index = 0;
        for col in 0..m {
            if col >= 2 {
                let normalized = scores[row - 1][col - 2] + (col - 2) as f64 * 18.;
                if normalized > gap {
                    gap = normalized;
                    gap_index = col - 2;
                }
            }
            if t.lower.get(row) != h.get(col) {
                continue;
            }
            let bonus = if boundary(v, col) { 170. } else { 0. }
                + if t.value[row] == v[col] { 25. } else { 0. };
            let mut score = if col > 0 {
                scores[row - 1][col - 1] + 260. + bonus
            } else {
                f64::NEG_INFINITY
            };
            let mut pred = col.saturating_sub(1);
            let gapped = gap - (col as f64 - 1.) * 18. + bonus;
            if gapped > score {
                score = gapped;
                pred = gap_index;
            }
            scores[row][col] = score;
            previous[row][col] = pred;
        }
    }
    let mut best = f64::NEG_INFINITY;
    let mut column = 0;
    for (col, value) in scores[n - 1].iter().enumerate() {
        let score = value - col as f64 * 2.;
        if score > best {
            best = score;
            column = col;
        }
    }
    if !best.is_finite() || best < 250. {
        return Ok(None);
    }
    let mut ranges = vec![];
    for row in (0..n).rev() {
        ranges.push([column as u32, column as u32 + 1]);
        column = previous[row][column];
    }
    Ok(Some(Local {
        score: best,
        ranges: merge(ranges),
        segment: 0,
    }))
}
fn text(
    t: &Term,
    v: &[u16],
    h: &[u16],
    closed: &AtomicBool,
) -> Result<Option<Local>, &'static str> {
    if t.value.is_empty() || v.is_empty() {
        return Ok(None);
    }
    let (score, start, end) = if t.lower == h {
        (3600. + if t.value == v { 80. } else { 0. }, 0, v.len())
    } else if h.starts_with(&t.lower) {
        (
            3000.
                + if t.value == v[..t.value.len().min(v.len())] {
                    80.
                } else {
                    0.
                },
            0,
            t.value.len(),
        )
    } else if let Some(i) = find(h, &t.lower) {
        let slice = &v[i.min(v.len())..(i + t.value.len()).min(v.len())];
        (
            2350. + if boundary(v, i) { 300. } else { 0. } - i as f64 * 10.
                + if t.value == slice { 80. } else { 0. },
            i,
            i + t.value.len(),
        )
    } else {
        return fuzzy(t, v, h, closed);
    };
    Ok(Some(Local {
        score,
        ranges: vec![[start as u32, end as u32]],
        segment: 0,
    }))
}
fn segment(
    c: &Candidate,
    t: &Term,
    i: usize,
    closed: &AtomicBool,
) -> Result<Option<Local>, &'static str> {
    let leaf = i + 1 == c.segments.len();
    let mut best = text(t, &c.segments[i], &c.segments_lower[i], closed)?;
    if let Some(m) = &mut best {
        m.score += if leaf { 1500. } else { 350. };
    }
    if leaf
        && !c.directory
        && c.stem != c.segments[i]
        && let Some(mut m) = text(t, &c.stem, &c.stem_lower, closed)?
    {
        m.score += 1900.;
        if best.as_ref().is_none_or(|b| m.score > b.score) {
            best = Some(m);
        }
    }
    let offset = 1 + c.segments[..i].iter().map(|s| s.len() + 1).sum::<usize>();
    if let Some(m) = &mut best {
        m.segment = i;
        for r in &mut m.ranges {
            r[0] += offset as u32;
            r[1] += offset as u32;
        }
    }
    Ok(best)
}
fn ordered(
    rows: &[Vec<Option<Local>>],
    count: usize,
    closed: &AtomicBool,
) -> Result<Option<Vec<Local>>, &'static str> {
    let mut scores = vec![vec![f64::NEG_INFINITY; count]; rows.len()];
    let mut prev = vec![vec![0; count]; rows.len()];
    for i in 0..count {
        cancelled(closed)?;
        if let Some(m) = &rows[0][i] {
            scores[0][i] = m.score - i as f64 * 35.;
        }
    }
    for t in 1..rows.len() {
        let mut best = f64::NEG_INFINITY;
        let mut index = None;
        for i in 0..count {
            cancelled(closed)?;
            if i > 0 && scores[t - 1][i - 1] > best {
                best = scores[t - 1][i - 1];
                index = Some(i - 1);
            }
            if let (Some(m), Some(p)) = (&rows[t][i], index) {
                scores[t][i] = best + m.score - (i - p - 1) as f64 * 45.;
                prev[t][i] = p;
            }
        }
    }
    let mut best = f64::NEG_INFINITY;
    let mut index = None;
    for (i, value) in scores[rows.len() - 1].iter().enumerate() {
        cancelled(closed)?;
        let score = value + if i + 1 == count { 500. } else { 0. };
        if score > best {
            best = score;
            index = Some(i);
        }
    }
    let Some(mut i) = index else {
        return Ok(None);
    };
    let mut out = vec![];
    for t in (0..rows.len()).rev() {
        let Some(m) = rows[t][i].clone() else {
            return Ok(None);
        };
        out.push(m);
        i = prev[t][i];
    }
    out.reverse();
    Ok(Some(out))
}
struct Assignment<'a> {
    options: &'a [Vec<Local>],
    order: Vec<usize>,
    remaining: Vec<f64>,
    best_score: f64,
    best: Option<Vec<Local>>,
    closed: &'a AtomicBool,
}
impl Assignment<'_> {
    fn visit(
        &mut self,
        at: usize,
        used: &mut [bool],
        chosen: &mut [Option<Local>],
        score: f64,
    ) -> Result<(), &'static str> {
        cancelled(self.closed)?;
        if score + self.remaining[at] <= self.best_score {
            return Ok(());
        }
        if at == self.order.len() {
            self.best_score = score;
            self.best = chosen.iter().cloned().collect();
            return Ok(());
        }
        let term = self.order[at];
        for m in &self.options[term] {
            if used[m.segment] {
                continue;
            }
            used[m.segment] = true;
            chosen[term] = Some(m.clone());
            self.visit(at + 1, used, chosen, score + m.score)?;
            used[m.segment] = false;
        }
        Ok(())
    }
}
type Ranked = Option<(f64, Vec<[u32; 2]>)>;
fn rank(c: &Candidate, q: &Query, closed: &AtomicBool) -> Result<Ranked, &'static str> {
    if q.value.is_empty() {
        return Ok(Some(empty(c)));
    }
    if q.folder && c.path_lower == q.path {
        return Ok(None);
    }
    let b = boost(c, q.folder);
    let depth = c.depth as f64;
    if c.path_lower == q.path {
        return Ok(Some((
            20000. + b - depth,
            vec![[
                1,
                (1 + q.path.len()).min(1 + c.path.len() + usize::from(c.directory)) as u32,
            ]],
        )));
    }
    if c.name_lower == q.lower || c.stem_lower == q.lower {
        let start = 1 + c.path.len() - c.name.len();
        let len = if c.stem_lower == q.lower {
            c.stem.len()
        } else {
            c.name.len()
        };
        return Ok(Some((
            18000. + b - depth,
            vec![[start as u32, (start + len) as u32]],
        )));
    }
    if c.path_lower.starts_with(&q.lower) {
        let rest = &c.path_lower[q.lower.len()..];
        let rest = rest
            .iter()
            .position(|c| *c != 47)
            .map_or(&[][..], |i| &rest[i..]);
        let remaining = if rest.is_empty() {
            0
        } else {
            1 + rest.iter().filter(|c| **c == 47).count()
        };
        return Ok(Some((
            16000. + b - remaining as f64 * 120. - depth * 6. - c.path.len() as f64 / 20.,
            vec![[
                1,
                (1 + q.value.len()).min(1 + c.path.len() + usize::from(c.directory)) as u32,
            ]],
        )));
    }
    if q.terms.is_empty() {
        return Ok(Some(empty(c)));
    }
    if q.terms.len() > 6 {
        return Ok(None);
    }
    let mut rows = vec![];
    for t in &q.terms {
        let mut row = vec![];
        for i in 0..c.segments.len() {
            cancelled(closed)?;
            row.push(segment(c, t, i, closed)?);
        }
        rows.push(row);
    }
    let matches = if q.ordered {
        ordered(&rows, c.segments.len(), closed)?
    } else {
        let mut options: Vec<Vec<Local>> = rows
            .into_iter()
            .map(|r| r.into_iter().flatten().collect())
            .collect();
        if options.iter().any(Vec::is_empty) {
            return Ok(None);
        }
        for o in &mut options {
            o.sort_by(|a, b| b.score.total_cmp(&a.score));
        }
        let mut order: Vec<usize> = (0..options.len()).collect();
        order.sort_by(|a, b| {
            options[*a]
                .len()
                .cmp(&options[*b].len())
                .then_with(|| options[*b][0].score.total_cmp(&options[*a][0].score))
        });
        let mut remaining = vec![0.; order.len() + 1];
        for i in (0..order.len()).rev() {
            remaining[i] = remaining[i + 1] + options[order[i]][0].score;
        }
        let mut assignment = Assignment {
            options: &options,
            order,
            remaining,
            best_score: f64::NEG_INFINITY,
            best: None,
            closed,
        };
        assignment.visit(
            0,
            &mut vec![false; c.segments.len()],
            &mut vec![None; q.terms.len()],
            0.,
        )?;
        assignment.best
    };
    Ok(matches.map(|ms| {
        (
            7000. + ms.iter().map(|m| m.score).sum::<f64>() + b
                - depth * 16.
                - c.path.len() as f64 / 8.,
            merge(ms.into_iter().flat_map(|m| m.ranges).collect()),
        )
    }))
}
fn compare(a: &Match, b: &Match, cs: &[Candidate]) -> Ordering {
    let ac = &cs[a.candidate_index];
    let bc = &cs[b.candidate_index];
    b.score
        .total_cmp(&a.score)
        .then(ac.depth.cmp(&bc.depth))
        .then(ac.path.len().cmp(&bc.path.len()))
        .then(bc.directory.cmp(&ac.directory))
        .then(ac.locale_rank.cmp(&bc.locale_rank))
        .then(a.candidate_index.cmp(&b.candidate_index))
}
pub fn query(
    cs: &[Candidate],
    q: &Query,
    limit: usize,
    closed: &AtomicBool,
) -> Result<Vec<Match>, &'static str> {
    cancelled(closed)?;
    let limit = limit.min(8);
    let mut out = vec![];
    if limit == 0 {
        return Ok(out);
    }
    for (i, c) in cs.iter().enumerate() {
        cancelled(closed)?;
        if let Some((score, ranges)) = rank(c, q, closed)? {
            let m = Match {
                candidate_index: i,
                score,
                ranges,
            };
            let at = out.partition_point(|x| compare(x, &m, cs) != Ordering::Greater);
            if at < limit {
                out.insert(at, m);
                out.truncate(limit);
            }
        }
    }
    cancelled(closed)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> Text {
        s.encode_utf16().collect()
    }
    fn term(s: &str) -> Term {
        Term {
            value: u(s),
            lower: u(&s.to_lowercase()),
        }
    }
    fn candidate(path: &str, rank: u32) -> Candidate {
        let segments: Vec<Text> = path.split('/').map(u).collect();
        let name = segments.last().unwrap().clone();
        Candidate {
            path: u(path),
            path_lower: u(&path.to_lowercase()),
            name: name.clone(),
            name_lower: name.clone(),
            stem: name.clone(),
            stem_lower: name,
            segments_lower: segments.clone(),
            depth: segments.len() as u32,
            segments,
            directory: false,
            locale_rank: rank,
        }
    }
    fn q(s: &str) -> Query {
        Query {
            value: u(s),
            lower: u(&s.to_lowercase()),
            path: u(s.trim_end_matches('/')),
            folder: s.ends_with('/'),
            ordered: s.contains('/'),
            terms: s
                .trim_end_matches('/')
                .split(if s.contains('/') { '/' } else { ' ' })
                .filter(|s| !s.is_empty())
                .map(term)
                .collect(),
        }
    }
    #[test]
    fn scores_and_utf16_offsets() {
        let cs = vec![candidate("😀/hello", 0)];
        let m = query(&cs, &q("hello"), 8, &AtomicBool::new(false)).unwrap();
        assert_eq!(m[0].score, 18178.);
        assert_eq!(m[0].ranges, vec![[4, 9]]);
        let m = query(&cs, &q("😀/he"), 8, &AtomicBool::new(false)).unwrap();
        assert_eq!(m[0].score, 16047.6);
        assert_eq!(m[0].ranges, vec![[1, 6]]);
    }
    #[test]
    fn ordered_and_distinct_unordered_terms() {
        let cs = vec![candidate("src/file", 0), candidate("file/src", 1)];
        let ordered = query(&cs, &q("sr/fi"), 8, &AtomicBool::new(false)).unwrap();
        assert_eq!(ordered.len(), 1);
        assert_eq!(ordered[0].candidate_index, 0);
        let unordered = query(&cs, &q("sr fi"), 8, &AtomicBool::new(false)).unwrap();
        assert_eq!(unordered.len(), 2);
        assert!(
            query(
                &[candidate("src", 0)],
                &q("s s"),
                8,
                &AtomicBool::new(false)
            )
            .unwrap()
            .is_empty()
        );
    }
    #[test]
    fn stable_locale_ranks_and_limit() {
        let cs = vec![candidate("bb", 1), candidate("aa", 0), candidate("AA", 0)];
        let m = query(&cs, &q(""), 2, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            m.iter().map(|m| m.candidate_index).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(
            query(&cs, &q(""), 0, &AtomicBool::new(false))
                .unwrap()
                .is_empty()
        );
        assert!(query(&cs, &q(""), 8, &AtomicBool::new(true)).is_err());
    }
    #[test]
    fn javascript_expansion_is_supplied_not_recased() {
        let mut c = candidate("İx", 0);
        c.path_lower = u("i\u{307}x");
        c.name_lower = c.path_lower.clone();
        c.stem_lower = c.path_lower.clone();
        c.segments_lower = vec![c.path_lower.clone()];
        let m = query(&[c], &q("i"), 8, &AtomicBool::new(false)).unwrap();
        assert_eq!(m[0].ranges, vec![[1, 2]]);
        assert_eq!(m[0].score, 16053.9);
    }
    #[test]
    fn fuzzy_cancellation_and_code_units() {
        let closed = AtomicBool::new(false);
        let m = text(&term("fb"), &u("fooBar"), &u("foobar"), &closed)
            .unwrap()
            .unwrap();
        assert_eq!(m.ranges, vec![[0, 1], [3, 4]]);
        assert!(
            text(
                &term("fb"),
                &u("fooBar"),
                &u("foobar"),
                &AtomicBool::new(true)
            )
            .is_err()
        );
        let t = Term {
            value: vec![0xd800],
            lower: vec![0xd800],
        };
        assert_eq!(
            text(&t, &[0xd800], &[0xd800], &closed)
                .unwrap()
                .unwrap()
                .ranges,
            vec![[0, 1]]
        );
    }
}
