//! Regel „Grafiktreiber“: Das Fenster ließ sich nicht öffnen, weil der Treiber OpenGL nicht bereitstellt (fehlender oder
//! veralteter Treiber, Remote-Desktop, Grafik der CPU statt der Grafikkarte). Die Hilfeseite von Mojang gibt es für
//! Windows (`WGL`-Meldungen); sie nennt Intel, AMD und NVIDIA gleichermaßen.
use super::text::{contains_any, evidence_where};
use super::{CrashContext, CrashDiagnosis, FixAction, Severity};

const MARKERS: [&str; 3] = ["GLFW error 65542", "WGL: The driver does not appear to support OpenGL", "Pixel format not accepted"];
/// Meldungen, die es nur unter Windows gibt.
const WINDOWS_MARKERS: [&str; 2] = ["WGL", "Pixel format not accepted"];
/// „Fix OpenGL Errors for Minecraft: Java Edition on Windows PC“ im Minecraft Help Center.
const WINDOWS_HELP_URL: &str =
    "https://help.minecraft.net/hc/en-us/articles/41964978313741-Fix-OpenGL-Errors-for-Minecraft-Java-Edition-on-Windows-PC";

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let evidence = evidence_where(context.text, is_graphics_line);
    if evidence.is_empty() {
        return None;
    }
    Some(CrashDiagnosis::new("graphicsDriver", Severity::Error, evidence).with_actions(windows_help(context.text)))
}

/// Eine Treibermeldung oder „OpenGL … not supported“.
fn is_graphics_line(line: &str) -> bool {
    contains_any(line, &MARKERS) || (line.contains("OpenGL") && line.contains("not supported"))
}

fn windows_help(text: &str) -> Option<FixAction> {
    contains_any(text, &WINDOWS_MARKERS).then(|| FixAction::OpenUrl { url: WINDOWS_HELP_URL.to_owned() })
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;

    const WINDOWS_ERROR: &str = "---- Minecraft Crash Report ----\n\
        Description: Initializing game\n\n\
        java.lang.IllegalStateException: GLFW error 65542: WGL: The driver does not appear to support OpenGL\n\
        \tat org.lwjgl.glfw.GLFW.glfwCreateWindow(GLFW.java:1)\n";

    const LINUX_ERROR: &str = "[12:00:01] [Render thread/ERROR]: GLFW error 65542: GLX: Failed to load GLX\n";

    fn run(text: &str) -> Option<CrashDiagnosis> {
        let instance = instance(Vec::new());
        diagnose(&context(text, &instance))
    }

    #[test]
    fn a_missing_windows_driver_points_to_the_help_page() {
        let found = run(WINDOWS_ERROR).unwrap();
        assert_eq!(found.id, "graphicsDriver");
        assert_eq!(found.actions, [FixAction::OpenUrl { url: WINDOWS_HELP_URL.into() }]);
        assert_eq!(found.evidence, ["java.lang.IllegalStateException: GLFW error 65542: WGL: The driver does not appear to support OpenGL"]);
    }

    #[test]
    fn other_systems_get_the_explanation_only() {
        let found = run(LINUX_ERROR).unwrap();
        assert!(found.actions.is_empty());
    }

    #[test]
    fn an_unsupported_opengl_version_counts() {
        let found = run("Caused by: java.lang.RuntimeException: OpenGL 3.2 is not supported by this graphics card\n").unwrap();
        assert_eq!(found.evidence.len(), 1);
        assert!(run("Pixel format not accepted\n").unwrap().actions.len() == 1);
    }

    #[test]
    fn other_crashes_are_not_a_driver_problem() {
        assert!(run("java.lang.NullPointerException\n").is_none());
        assert!(run("OpenGL debug message: all good\n").is_none());
    }
}
