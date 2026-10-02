//! Die Anbieter ohne Modrinth, wie das Frontend sie als `source` nennt.
use crate::coded;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Ftb,
    Technic,
    CurseForge,
}

impl Source {
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "ftb" => Ok(Self::Ftb),
            "technic" => Ok(Self::Technic),
            "curseforge" => Ok(Self::CurseForge),
            _ => Err(AppError::invalid(coded!("errors.providers.unknownProvider"))),
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Ftb => "ftb",
            Self::Technic => "technic",
            Self::CurseForge => "curseforge",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sources() {
        assert_eq!(Source::parse("ftb").unwrap(), Source::Ftb);
        assert_eq!(Source::parse("curseforge").unwrap().key(), "curseforge");
        assert!(Source::parse("../x").is_err());
    }
}
