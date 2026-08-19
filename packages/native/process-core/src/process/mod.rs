mod managed;
mod model;

pub use managed::{ManagedProcess, ManagedProcessEvents, SpawnOptions, spawn};
pub use model::{
    Containment, InspectionEvidence, InspectionResult, ManagedTarget, ProcessPriority,
    TerminationMethod, TerminationResult,
};
