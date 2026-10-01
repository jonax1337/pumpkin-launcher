import { isTauri } from "@tauri-apps/api/core";
import { createTauriBackend } from "./backend-tauri";
import type { Backend } from "./backend";

// Mock nur im Dev-Server: im Release-Build ist das konstant true, Vite wirft den Mock samt Import heraus.
const tauri = !import.meta.env.DEV || isTauri();

/**
 * Einziger Zugang zum Backend: in der App die Tauri-Commands, außerhalb von Tauri (reiner `pnpm dev` im Browser)
 * ein In-Memory-Mock, damit die UI vorführbar bleibt. Gewählt wird einmal beim Start.
 */
export const api: Backend = tauri ? createTauriBackend() : (await import("./mock-backend")).createMockBackend();
