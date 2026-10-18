use std::sync::atomic::{AtomicBool, Ordering};

/// Cooperative cancellation only. Owners decide whether/when to await in-flight work.
#[derive(Default)]
pub(crate) struct CancellationToken(std::sync::Arc<AtomicBool>);

impl CancellationToken {
    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub(crate) fn flag(&self) -> &AtomicBool {
        &self.0
    }

    /// Shares the same sticky flag with libraries that require an owned atomic.
    pub(crate) fn owned_flag(&self) -> std::sync::Arc<AtomicBool> {
        self.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owned_atomic_and_borrowed_flag_are_the_same_token() {
        let token = CancellationToken::default();
        token.owned_flag().store(true, Ordering::Release);
        assert!(token.is_cancelled());
        assert!(token.flag().load(Ordering::Acquire));
    }

    #[test]
    fn cancellation_is_sticky_and_visible_across_threads() {
        let token = std::sync::Arc::new(CancellationToken::default());
        let worker = token.clone();
        std::thread::spawn(move || worker.cancel()).join().unwrap();
        assert!(token.is_cancelled());
        token.cancel();
        assert!(token.flag().load(Ordering::Relaxed));
        assert!(token.owned_flag().load(Ordering::Acquire));
    }
}
