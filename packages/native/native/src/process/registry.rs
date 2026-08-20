use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

static CONFIGURED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static MAX_ACTIVE: AtomicUsize = AtomicUsize::new(usize::MAX);
static ACTIVE: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn configure(max_active: usize) -> Result<(), String> {
    if max_active == 0 {
        return Err("maxActiveProcesses must be positive".to_string());
    }
    let current = MAX_ACTIVE.load(Ordering::Acquire);
    if CONFIGURED.load(Ordering::Acquire) {
        return if current == max_active {
            Ok(())
        } else {
            Err("Managed process runtime was already configured differently".to_string())
        };
    }
    if STARTED.load(Ordering::Acquire) {
        return Err(
            "Managed process runtime must be configured before the first spawn".to_string(),
        );
    }
    MAX_ACTIVE.store(max_active, Ordering::Release);
    CONFIGURED.store(true, Ordering::Release);
    Ok(())
}

pub(crate) struct ActivePermit;

impl ActivePermit {
    pub(crate) fn acquire() -> Result<Self, String> {
        STARTED.store(true, Ordering::Release);
        let maximum = MAX_ACTIVE.load(Ordering::Acquire);
        let result = ACTIVE.fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
            (active < maximum).then_some(active + 1)
        });
        result
            .map(|_| Self)
            .map_err(|_| format!("Managed process capacity reached ({maximum} active processes)"))
    }
}

impl Drop for ActivePermit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}
