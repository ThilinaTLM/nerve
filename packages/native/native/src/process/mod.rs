mod manager;
mod model;
mod output;
mod policy;
mod registry;

pub(crate) use manager::{ManagedProcess, ManagedProcessEvents, SpawnOptions, spawn};
pub(crate) use model::{
    Containment, EnforcementEntry, ExitReason, InspectionResult, ManagedTarget, TerminationMethod,
    TerminationResult,
};
pub(crate) use output::{IngestResult, OutputDrain, OutputQueue, OutputStats, OutputStream};
pub(crate) use policy::{
    EnforcementMode, OutputOverflow, OutputPolicy, RequestedOutputPolicy, RequestedPolicy,
    ResourcePolicy,
};
pub(crate) use registry::{ActivePermit, configure as configure_registry};
