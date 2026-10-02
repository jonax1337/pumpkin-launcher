// JVM-Argumente: die Vorgaben des Launchers und das Zerlegen eines Eingabetexts.

/** Vorgabe der JVM-Argumente in den Einstellungen: zwei erprobte Sätze oder ein eigener Text. */
export type JvmPreset = "balanced" | "lowLatency" | "custom";

export const JVM_PRESETS: JvmPreset[] = ["balanced", "lowLatency", "custom"];

const PRESET_ARGS = {
  // Die Vorgaben des offiziellen Minecraft-Launchers.
  balanced: [
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseG1GC",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
  ],
  // Aikars Flags für G1 ohne AlwaysPreTouch: das belegte beim Start den ganzen Heap und verzögerte ihn spürbar.
  lowLatency: [
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+DisableExplicitGC",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
  ],
} satisfies Record<Exclude<JvmPreset, "custom">, string[]>;

/** Je Leerzeichen ein Argument. */
export const splitArgs = (text: string) => text.split(/\s+/).filter(Boolean);

/** Die Argumente, die eine Vorgabe ergibt; `custom` ist der Text, den der Nutzer bei „Eigene“ eingegeben hat. */
export const presetArgs = (preset: JvmPreset, custom: string): string[] =>
  preset === "custom" ? splitArgs(custom) : PRESET_ARGS[preset];
