//! Per-read cancellation and result accounting, not a second Git engine.
use super::{ErrorKind, GitReadError};
use crate::core::cancellation::CancellationToken;
use std::cell::Cell;

pub(super) struct ReadContext<'a> {
    token: &'a CancellationToken,
    remaining: Cell<usize>,
    walked: Cell<usize>,
}
impl<'a> ReadContext<'a> {
    pub(super) fn bounded(token: &'a CancellationToken) -> Self {
        Self {
            token,
            walked: Cell::new(0),
            remaining: Cell::new(16 * 1024 * 1024),
        }
    }
    pub(super) fn check(&self) -> Result<(), GitReadError> {
        if self.token.is_cancelled() {
            return Err(GitReadError::new(
                ErrorKind::Cancelled,
                "Git metadata read cancelled",
            ));
        }
        Ok(())
    }
    pub(super) fn walk_step(&self) -> Result<(), GitReadError> {
        self.check()?;
        let count = self.walked.get() + 1;
        if count > 1_000_000 {
            return Err(GitReadError::new(
                ErrorKind::LimitExceeded,
                "Git metadata revision walk exceeds one million commits",
            ));
        }
        self.walked.set(count);
        Ok(())
    }
    pub(super) fn account(&self, bytes: usize) -> Result<(), GitReadError> {
        self.check()?;
        let remaining = self.remaining.get().checked_sub(bytes).ok_or_else(|| {
            GitReadError::new(
                ErrorKind::LimitExceeded,
                "Git metadata result exceeds 16 MiB accounting limit",
            )
        })?;
        self.remaining.set(remaining);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn result_bound_is_explicit_and_cancellation_is_checked_between_records() {
        let token = CancellationToken::default();
        let context = ReadContext::bounded(&token);
        context.account(16 * 1024 * 1024).unwrap();
        assert_eq!(
            context.account(1).unwrap_err().kind,
            ErrorKind::LimitExceeded
        );
        token.cancel();
        assert_eq!(context.account(0).unwrap_err().kind, ErrorKind::Cancelled);
        assert_eq!(context.walk_step().unwrap_err().kind, ErrorKind::Cancelled);
    }
    #[test]
    fn revision_walk_budget_is_aggregate_and_never_truncates() {
        let token = CancellationToken::default();
        let context = ReadContext::bounded(&token);
        for _ in 0..1_000_000 {
            context.walk_step().unwrap();
        }
        assert_eq!(
            context.walk_step().unwrap_err().kind,
            ErrorKind::LimitExceeded
        );
    }
}
