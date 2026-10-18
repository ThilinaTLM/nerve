use std::sync::atomic::{AtomicUsize, Ordering};

/// Reject-at-capacity admission. Queueing and configured limits stay with the owner.
pub(crate) struct ActivePermit<'a>(&'a AtomicUsize);

impl<'a> ActivePermit<'a> {
    pub(crate) fn acquire(active: &'a AtomicUsize, maximum: usize) -> Option<Self> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < maximum).then_some(active + 1)
            })
            .ok()
            .map(|_| Self(active))
    }
}

impl Drop for ActivePermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_bound_concurrent_admission_and_release_on_drop() {
        let active = AtomicUsize::new(0);
        let first = ActivePermit::acquire(&active, 1).unwrap();
        assert!(ActivePermit::acquire(&active, 1).is_none());
        drop(first);
        assert!(ActivePermit::acquire(&active, 1).is_some());
        assert_eq!(active.load(Ordering::Acquire), 0);
    }
}
