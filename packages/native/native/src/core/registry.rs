use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Existing monitor ID allocation/lookup mechanism, not a shared close policy.
pub(crate) struct HandleRegistry<T> {
    next: AtomicU32,
    entries: Mutex<HashMap<u32, Arc<T>>>,
}

impl<T> HandleRegistry<T> {
    pub(crate) fn new() -> Self {
        Self {
            next: AtomicU32::new(1),
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn insert(&self, value: Arc<T>) -> u32 {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let id = loop {
            let candidate = self.next.fetch_add(1, Ordering::Relaxed);
            if candidate != 0 && !entries.contains_key(&candidate) {
                break candidate;
            }
        };
        entries.insert(id, value);
        id
    }

    pub(crate) fn get(&self, id: u32) -> Option<Arc<T>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .cloned()
    }

    pub(crate) fn remove(&self, id: u32) -> Option<Arc<T>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removal_revokes_lookup_but_not_in_flight_ownership() {
        let registry = HandleRegistry::new();
        let id = registry.insert(Arc::new(42));
        let in_flight = registry.get(id).unwrap();
        assert_ne!(id, 0);
        assert_eq!(*registry.remove(id).unwrap(), 42);
        assert!(registry.get(id).is_none());
        assert!(registry.remove(id).is_none());
        assert_eq!(*in_flight, 42);
    }

    #[test]
    fn wrapping_ids_skip_zero_and_live_entries() {
        let registry = HandleRegistry::new();
        assert_eq!(registry.insert(Arc::new(1)), 1);
        registry.next.store(u32::MAX, Ordering::Relaxed);
        assert_eq!(registry.insert(Arc::new(2)), u32::MAX);
        assert_eq!(registry.insert(Arc::new(3)), 2);
    }
}
