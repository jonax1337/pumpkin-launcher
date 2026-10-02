import { spawn } from 'node:child_process';

// Fernsteuerung (z. B. DWService) überträgt jede Bildänderung. Die Pixel-Szenen ändern das Bild etwa 12-mal pro Sekunde
// und legen die Verbindung lahm. Das Flag lässt WebView2 „reduzierte Bewegung“ melden, dann stehen die Szenen still.
const reducedMotion = '--force-prefers-reduced-motion';
const browserArgs = [process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, reducedMotion].filter(Boolean).join(' ');

spawn(['pnpm', 'tauri', 'dev', ...process.argv.slice(2)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs },
}).on('exit', (code) => process.exit(code ?? 1));
