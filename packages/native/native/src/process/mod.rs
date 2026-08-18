mod managed;
mod model;

pub(crate) use managed::{ManagedProcess, ManagedProcessEvents, SpawnOptions, spawn};
pub(crate) use model::{
    Containment, InspectionResult, ManagedTarget, TerminationMethod, TerminationResult,
};
