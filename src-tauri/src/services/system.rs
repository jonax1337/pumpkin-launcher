//! Angaben zum PC: Arbeitsspeicher, freier Platz, Betriebssystem. Je System ein Untermodul mit denselben Funktionen.
#[cfg(target_os = "linux")]
pub use linux::{os_version, total_memory_mb};
#[cfg(target_os = "macos")]
pub use macos::{os_version, total_memory_mb};
#[cfg(unix)]
pub use unix::free_space_mb;
#[cfg(windows)]
pub use windows::{free_space_mb, os_version, total_memory_mb};

const MIB: u64 = 1024 * 1024;

/// `MemTotal` aus `/proc/meminfo` in KiB.
#[cfg(any(target_os = "linux", test))]
fn meminfo_total_kib(meminfo: &str) -> Option<u64> {
    let line = meminfo.lines().find_map(|line| line.strip_prefix("MemTotal:"))?;
    line.trim().strip_suffix("kB")?.trim().parse().ok()
}

/// `PRETTY_NAME` aus `/etc/os-release`, z. B. „Ubuntu 24.04.1 LTS“ (Wert darf in Anführungszeichen stehen).
#[cfg(any(target_os = "linux", test))]
fn os_release_name(os_release: &str) -> Option<String> {
    let value = os_release.lines().find_map(|line| line.strip_prefix("PRETTY_NAME="))?;
    Some(value.trim().trim_matches(['"', '\'']).to_owned()).filter(|name| !name.is_empty())
}

#[cfg(windows)]
mod windows {
    use std::path::Path;

    use super::MIB;
    use crate::error::AppResult;

    /// Physischer Arbeitsspeicher in MiB (Grundlage für RAM-Vorgabe und Slider-Obergrenze).
    pub fn total_memory_mb() -> AppResult<u64> {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut status = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..unsafe { std::mem::zeroed() } };
        // SAFETY: `status` ist ein gültiger, beschreibbarer MEMORYSTATUSEX mit gesetzter Länge.
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(status.ullTotalPhys / MIB)
    }

    /// Freier Platz in MiB auf dem Laufwerk von `path`, so viel wie dieser Benutzer belegen darf (Kontingente).
    pub fn free_space_mb(path: &Path) -> AppResult<u64> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        let mut free = 0u64;
        // SAFETY: `wide` ist nullterminiert; die nicht gebrauchten Ausgaben dürfen laut API null sein.
        if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(free / MIB)
    }

    /// Betriebssystem mit Versionsnummer, z. B. „Windows 11 (10.0.26200)“.
    pub fn os_version() -> String {
        use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
        use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
        let mut info = OSVERSIONINFOW { dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as u32, ..unsafe { std::mem::zeroed() } };
        // RtlGetVersion statt GetVersionEx: das liefert ohne Manifest die Version von Windows 8.
        // SAFETY: `info` ist ein gültiger, beschreibbarer OSVERSIONINFOW mit gesetzter Größe.
        unsafe { RtlGetVersion(&mut info) };
        // Windows 11 meldet weiter Version 10; erkennbar ist es nur an der Build-Nummer.
        let name = match (info.dwMajorVersion, info.dwBuildNumber) {
            (10, 22000..) => "Windows 11",
            (10, _) => "Windows 10",
            _ => "Windows",
        };
        format!("{name} ({}.{}.{})", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber)
    }
}

#[cfg(unix)]
mod unix {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    use super::MIB;
    use crate::error::AppResult;

    /// Freier Platz in MiB im Dateisystem von `path`, ohne die Reserve für root.
    pub fn free_space_mb(path: &Path) -> AppResult<u64> {
        let path = CString::new(path.as_os_str().as_bytes()).map_err(std::io::Error::from)?;
        // SAFETY: Ein genullter statvfs ist gültig (nur Zahlen); `path` ist nullterminiert.
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(stat.f_bavail as u64 * stat.f_frsize as u64 / MIB)
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use crate::error::{AppError, AppResult};

    /// Physischer Arbeitsspeicher in MiB (Grundlage für RAM-Vorgabe und Slider-Obergrenze).
    pub fn total_memory_mb() -> AppResult<u64> {
        let meminfo = std::fs::read_to_string("/proc/meminfo")?;
        let kib = super::meminfo_total_kib(&meminfo).ok_or_else(|| AppError::invalid("Der Arbeitsspeicher ließ sich nicht ermitteln."))?;
        Ok(kib / 1024)
    }

    /// Distribution mit Version, z. B. „Ubuntu 24.04.1 LTS“; ohne `os-release` nur „Linux“.
    pub fn os_version() -> String {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| super::os_release_name(&text))
            .unwrap_or_else(|| "Linux".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CStr;

    use super::MIB;
    use crate::error::AppResult;

    /// Liest den sysctl-Wert `name` in `buf` und liefert, wie viele Bytes er belegt.
    fn sysctl(name: &CStr, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut len = buf.len();
        // SAFETY: `buf` ist `len` Bytes groß und beschreibbar; ohne neuen Wert (null, 0) wird nur gelesen.
        let status = unsafe { libc::sysctlbyname(name.as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) };
        if status != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(len)
    }

    /// Physischer Arbeitsspeicher in MiB (Grundlage für RAM-Vorgabe und Slider-Obergrenze).
    pub fn total_memory_mb() -> AppResult<u64> {
        let mut bytes = [0u8; 8];
        sysctl(c"hw.memsize", &mut bytes)?;
        Ok(u64::from_ne_bytes(bytes) / MIB)
    }

    /// Betriebssystem mit Versionsnummer, z. B. „macOS 15.1“.
    pub fn os_version() -> String {
        let mut text = [0u8; 32];
        match sysctl(c"kern.osproductversion", &mut text) {
            Ok(len) => format!("macOS {}", String::from_utf8_lossy(&text[..len]).trim_end_matches('\0')),
            Err(_) => "macOS".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_values_are_plausible() {
        let mb = total_memory_mb().unwrap();
        assert!((512..16 * 1024 * 1024).contains(&mb), "{mb}");
        assert!(free_space_mb(&std::env::temp_dir()).unwrap() > 0);
        assert!(!os_version().is_empty());
    }

    #[test]
    fn reads_total_memory_from_meminfo() {
        let meminfo = "MemTotal:       16318412 kB\nMemFree:         1024 kB\n";
        assert_eq!(meminfo_total_kib(meminfo), Some(16_318_412));
        assert_eq!(meminfo_total_kib("MemFree: 1024 kB"), None);
    }

    #[test]
    fn reads_distribution_name_from_os_release() {
        assert_eq!(os_release_name("NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\n").as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(os_release_name("PRETTY_NAME=Arch Linux").as_deref(), Some("Arch Linux"));
        assert_eq!(os_release_name("PRETTY_NAME=\"\"\nID=void"), None);
    }
}
