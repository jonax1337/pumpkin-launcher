//! Angaben zum PC: Arbeitsspeicher, freier Platz, Windows-Version. Unter Windows über die Win32-API.
use std::path::Path;

use crate::error::AppResult;

const MIB: u64 = 1024 * 1024;

/// Physischer Arbeitsspeicher in MiB (Grundlage für RAM-Vorgabe und Slider-Obergrenze).
pub fn total_memory_mb() -> AppResult<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut status = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..unsafe { std::mem::zeroed() } };
        // SAFETY: `status` ist ein gültiger, beschreibbarer MEMORYSTATUSEX mit gesetzter Länge.
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(status.ullTotalPhys / MIB)
    }
    #[cfg(not(windows))]
    Err(crate::error::AppError::NotImplemented("Die Speicheranzeige außerhalb von Windows"))
}

/// Freier Platz in MiB auf dem Laufwerk von `path`, so viel wie dieser Benutzer belegen darf (Kontingente).
#[cfg_attr(not(windows), allow(unused_variables))]
pub fn free_space_mb(path: &Path) -> AppResult<u64> {
    #[cfg(windows)]
    {
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
    #[cfg(not(windows))]
    Err(crate::error::AppError::NotImplemented("Die Speicherplatzanzeige außerhalb von Windows"))
}

/// Betriebssystem mit Versionsnummer, z. B. „Windows 11 (10.0.26200)“.
pub fn os_version() -> String {
    #[cfg(windows)]
    {
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
    #[cfg(not(windows))]
    std::env::consts::OS.to_owned()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn system_values_are_plausible() {
        let mb = total_memory_mb().unwrap();
        assert!((1024..16 * 1024 * 1024).contains(&mb), "{mb}");
        assert!(free_space_mb(&std::env::temp_dir()).unwrap() > 0);
        assert!(os_version().starts_with("Windows 1"), "{}", os_version());
    }
}
