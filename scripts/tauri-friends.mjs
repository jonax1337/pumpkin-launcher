import { spawn } from 'node:child_process';

// Dev start with the friends directory attached (docs/friends/BYNAME.md OD-N5). Official release builds get the
// address from the release workflow; a plain `tauri dev` build intentionally has none, which hides the name tab.
const FRIENDS_DIRECTORY = 'https://pumpkin-friends-directory.jonas-laux.workers.dev';

spawn(['pnpm', 'tauri', 'dev', ...process.argv.slice(2)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PUMPKIN_FRIENDS_DIRECTORY: process.env.PUMPKIN_FRIENDS_DIRECTORY ?? FRIENDS_DIRECTORY,
  },
}).on('exit', (code) => process.exit(code ?? 1));
