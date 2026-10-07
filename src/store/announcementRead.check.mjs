// Run: node src/store/announcementRead.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
globalThis.window = { localStorage: globalThis.localStorage };

const storageKey = 'launcher-announcement-read';
let imports = 0;
async function restart() {
  const module = await import(`./announcementRead.ts?restart=${++imports}`);
  return module.useAnnouncementReadStore;
}

let store = await restart();
store.getState().markRead('tag:launcher,2026:release-a');
store = await restart();
assert.deepEqual(store.getState().readIds, ['tag:launcher,2026:release-a'], 'exactly the selected announcement survives restart');

store.getState().markRead('tag:launcher,2026:release-b');
const beforeUnread = store.getState().readIds;
store.getState().markUnread('tag:launcher,2026:release-a');
assert.deepEqual(beforeUnread, ['tag:launcher,2026:release-a', 'tag:launcher,2026:release-b']);
store = await restart();
assert.deepEqual(store.getState().readIds, ['tag:launcher,2026:release-b'], 'restored unread status survives restart without clearing other articles');

const loadedPage = ['tag:launcher,2026:release-c', 'tag:launcher,2026:release-c', 'tag:launcher,2026:release-d'];
const earlierPageIds = store.getState().readIds;
store.getState().markAllRead(loadedPage);
loadedPage.push('not-loaded-at-click');
assert.deepEqual(earlierPageIds, ['tag:launcher,2026:release-b'], 'bulk updates preserve earlier snapshots');
store = await restart();
assert.deepEqual(store.getState().readIds, [
  'tag:launcher,2026:release-b',
  'tag:launcher,2026:release-c',
  'tag:launcher,2026:release-d',
], 'bulk persists the union, keeping older pages without duplicates or caller-owned arrays');

storage.set(storageKey, JSON.stringify({
  state: { readIds: ['valid-id', null, 42, '', 'valid-id', 'another-id'], markRead: 'not an action' },
  version: 1,
}));
store = await restart();
assert.deepEqual(store.getState().readIds, ['valid-id', 'another-id'], 'hydration filters malformed IDs and duplicates');
store.getState().markRead('still-functional');
store = await restart();
assert.deepEqual(store.getState().readIds, ['valid-id', 'another-id', 'still-functional'], 'persisted fields cannot replace store actions');

for (const state of [null, {}, { readIds: 'not-an-array' }]) {
  storage.set(storageKey, JSON.stringify({ state, version: 1 }));
  store = await restart();
  assert.deepEqual(store.getState().readIds, [], 'malformed persisted state starts unread');
  store.getState().markRead('recoverable');
  store = await restart();
  assert.deepEqual(store.getState().readIds, ['recoverable'], 'valid changes repair malformed persisted state');
}

console.log('announcementRead.check: ok');
