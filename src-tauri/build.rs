fn main() {
    // Icon resources must invalidate the Windows executable as well as codegen.
    for icon in ["icons/icon.ico", "icons/icon.png", "icons/128x128.png"] {
        println!("cargo:rerun-if-changed={icon}");
    }
    tauri_build::build();
}
