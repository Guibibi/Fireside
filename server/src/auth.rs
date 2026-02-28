use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;

#[derive(Debug, Serialize, Deserialize)]
struct RawClaims {
    pub user_id: String,
    pub username: String,
    pub role: String,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct Claims {
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
    #[allow(dead_code)]
    pub exp: usize,
}

pub fn create_token(
    user_id: Uuid,
    username: &str,
    role: &str,
    secret: &str,
    expiration_hours: u64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::hours(expiration_hours as i64))
        .expect("valid timestamp")
        .timestamp() as usize;

    let raw = RawClaims {
        user_id: user_id.to_string(),
        username: username.to_string(),
        role: role.to_string(),
        exp: expiration,
    };

    encode(
        &Header::default(),
        &raw,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn validate_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let token_data = decode::<RawClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(e.to_string()))?;

    let raw = token_data.claims;
    let user_id: Uuid = raw
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("Invalid user ID in token".into()))?;

    Ok(Claims {
        user_id,
        username: raw.username,
        role: raw.role,
        exp: raw.exp,
    })
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Failed to hash password: {e}")))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn generate_invite_code() -> String {
    const CHARSET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut bytes = [0u8; 12];
    OsRng.fill_bytes(&mut bytes);
    let chars: Vec<char> = bytes
        .iter()
        .map(|b| CHARSET[(*b as usize) % CHARSET.len()] as char)
        .collect();
    format!(
        "{}-{}-{}-{}",
        &chars[0..3].iter().collect::<String>(),
        &chars[3..6].iter().collect::<String>(),
        &chars[6..9].iter().collect::<String>(),
        &chars[9..12].iter().collect::<String>(),
    )
}

pub fn extract_claims(headers: &axum::http::HeaderMap, secret: &str) -> Result<Claims, AppError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing authorization header".into()))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid authorization format".into()))?;

    validate_token(token, secret)
}

pub fn is_operator_or_admin_role(role: &str) -> bool {
    role == "operator" || role == "admin"
}

#[allow(dead_code)]
pub fn require_operator_or_admin(claims: &Claims, action: &str) -> Result<(), AppError> {
    if !is_operator_or_admin_role(&claims.role) {
        return Err(AppError::Unauthorized(format!(
            "Only operators and admins can {action}",
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims_with_role(role: &str) -> Claims {
        Claims {
            user_id: Uuid::new_v4(),
            username: "tester".to_string(),
            role: role.to_string(),
            exp: 0,
        }
    }

    #[test]
    fn privileged_roles_are_allowed() {
        let operator = claims_with_role("operator");
        let admin = claims_with_role("admin");

        assert!(require_operator_or_admin(&operator, "manage settings").is_ok());
        assert!(require_operator_or_admin(&admin, "manage settings").is_ok());
    }

    #[test]
    fn non_privileged_roles_are_rejected() {
        let member = claims_with_role("member");
        let result = require_operator_or_admin(&member, "manage settings");

        match result {
            Err(AppError::Unauthorized(message)) => {
                assert_eq!(message, "Only operators and admins can manage settings");
            }
            _ => panic!("expected unauthorized error"),
        }
    }
}
