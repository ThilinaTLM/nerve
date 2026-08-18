use gix::bstr::ByteSlice;

use super::error::{ErrorKind, GitReadError};
use super::model::Ancestry;

pub fn check(path: &str, ancestor: &str, descendant: &str) -> Result<Ancestry, GitReadError> {
    let repo = gix::open(path).map_err(|error| GitReadError::from_gix("open repository", error))?;
    let ancestor = repo
        .rev_parse_single(ancestor)
        .map_err(|error| GitReadError::from_gix("resolve ancestor", error))?;
    let descendant = repo
        .rev_parse_single(descendant)
        .map_err(|error| GitReadError::from_gix("resolve descendant", error))?;
    let is_ancestor = match repo.merge_base(ancestor, descendant) {
        Ok(merge_base) => merge_base.as_ref() == ancestor.as_ref(),
        Err(gix::repository::merge_base::Error::NotFound { .. }) => false,
        Err(error) => return Err(GitReadError::from_gix("compute merge base", error)),
    };
    Ok(Ancestry {
        ancestor_oid: ancestor.to_string(),
        descendant_oid: descendant.to_string(),
        is_ancestor,
    })
}

pub fn validate_branch_name(name: &str) -> Result<bool, GitReadError> {
    if name.is_empty() {
        return Ok(false);
    }
    let full_name = format!("refs/heads/{name}");
    Ok(gix::validate::reference::branch_name(full_name.as_bytes().as_bstr()).is_ok())
}

pub fn resolve_revision(path: &str, revision: &str) -> Result<String, GitReadError> {
    if revision.is_empty() {
        return Err(GitReadError::new(
            ErrorKind::InvalidInput,
            "revision must not be empty",
        ));
    }
    let repo = gix::open(path).map_err(|error| GitReadError::from_gix("open repository", error))?;
    repo.rev_parse_single(revision)
        .map(|id| id.to_string())
        .map_err(|error| GitReadError::from_gix("resolve revision", error))
}

#[cfg(test)]
mod tests {
    use super::validate_branch_name;

    #[test]
    fn validates_branch_names_with_git_rules() {
        assert!(validate_branch_name("feature/native").unwrap());
        assert!(!validate_branch_name("bad..branch").unwrap());
        assert!(!validate_branch_name("").unwrap());
    }
}
