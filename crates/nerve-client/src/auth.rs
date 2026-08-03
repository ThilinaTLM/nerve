use std::fmt;

use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};

use crate::{ClientError, Result};

#[derive(Clone)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(ClientError::Configuration("daemon token is empty".into()));
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }

    pub(crate) fn authorization_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        let value = HeaderValue::from_str(&format!("Bearer {}", self.expose())).map_err(|_| {
            ClientError::Configuration("daemon token is not a valid HTTP header value".into())
        })?;
        headers.insert(AUTHORIZATION, value);
        Ok(headers)
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret([REDACTED])")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

#[cfg(test)]
mod tests {
    use super::Secret;

    #[test]
    fn secret_is_redacted() {
        let secret = Secret::new("top-secret").expect("valid secret");
        assert_eq!(format!("{secret}"), "[REDACTED]");
        assert_eq!(format!("{secret:?}"), "Secret([REDACTED])");
    }
}
