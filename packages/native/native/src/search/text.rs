use std::ops::{Deref, Range};
use std::sync::Arc;

/// UTF-16 views share backing storage: path/name/stem/segments do not copy text.
#[derive(Clone, Debug)]
pub struct Text {
    data: Arc<Vec<u16>>,
    start: u32,
    end: u32,
}
impl Text {
    pub fn slice(&self, range: Range<usize>) -> Self {
        Self {
            data: self.data.clone(),
            start: self.start + range.start as u32,
            end: self.start + range.end as u32,
        }
    }
    pub fn ascii_lower(&self) -> Self {
        if self.iter().any(|c| (65..=90).contains(c)) {
            self.iter()
                .map(|c| if (65..=90).contains(c) { c + 32 } else { *c })
                .collect()
        } else {
            self.clone()
        }
    }
    pub fn split_path(&self) -> Vec<Self> {
        let mut start = 0;
        let mut result = Vec::new();
        for (i, c) in self.iter().enumerate() {
            if *c == 47 {
                result.push(self.slice(start..i));
                start = i + 1;
            }
        }
        result.push(self.slice(start..self.len()));
        result
    }
}
impl From<Vec<u16>> for Text {
    fn from(data: Vec<u16>) -> Self {
        Self {
            start: 0,
            end: data.len() as u32,
            data: Arc::new(data),
        }
    }
}
impl FromIterator<u16> for Text {
    fn from_iter<T: IntoIterator<Item = u16>>(iter: T) -> Self {
        Vec::from_iter(iter).into()
    }
}
impl Deref for Text {
    type Target = [u16];
    fn deref(&self) -> &[u16] {
        &self.data[self.start as usize..self.end as usize]
    }
}
impl PartialEq for Text {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}
impl Eq for Text {}
impl PartialEq<[u16]> for Text {
    fn eq(&self, other: &[u16]) -> bool {
        **self == *other
    }
}
impl PartialEq<&[u16]> for Text {
    fn eq(&self, other: &&[u16]) -> bool {
        **self == **other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_views_share_backing_and_preserve_lone_utf16_units() {
        let path: Text = vec![97, 47, 0xd800, 46, 116, 115].into();
        let segments = path.split_path();
        assert!(Arc::ptr_eq(&path.data, &segments[0].data));
        assert!(Arc::ptr_eq(&path.data, &segments[1].data));
        assert_eq!(&*segments[1], &[0xd800, 46, 116, 115]);
        assert!(Arc::ptr_eq(&path.data, &path.ascii_lower().data));
        let upper: Text = vec![65, 0xd800].into();
        let lower = upper.ascii_lower();
        assert_eq!(&*lower, &[97, 0xd800]);
        assert!(!Arc::ptr_eq(&upper.data, &lower.data));
    }
}
