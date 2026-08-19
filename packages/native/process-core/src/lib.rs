pub mod process;
pub mod sys;

pub use process::{
    Containment, InspectionEvidence, InspectionResult, ManagedProcess, ManagedProcessEvents,
    ManagedTarget, ProcessPriority, SpawnOptions, TerminationMethod, TerminationResult, spawn,
};
pub use sys::process::{capabilities, inspect, terminate};
