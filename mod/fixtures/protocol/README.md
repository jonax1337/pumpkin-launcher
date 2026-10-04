# Protocol 2 fixtures

Golden JSON lines of the launcher-mod channel (`docs/friends/INGAME.md`, 5.3 and 5.4). They are the shared contract:
the Rust tests (`src-tauri/src/services/modbridge/tests_fixtures.rs`) parse every line into the typed protocol and write
it back; the Java mod tests read the same files. Keep them stable and minimal. A change here is a protocol change.

## Format

One scenario per `*.jsonl` file, one JSON object per line:

```json
{"direction":"modToLauncher","line":{"type":"ping"}}
```

| `direction` | meaning |
|---|---|
| `modToLauncher` | `line` is what the mod sends |
| `launcherToMod` | `line` is what the launcher sends |
| `none` | `line` is data, not a wire line (`limits.jsonl`) |

`line` is the exact wire message (the wire itself is the compact `line` followed by `\n`). Key order is not significant.
The token in `hello` is the placeholder `0123456789abcdef` repeated four times; a replaying test substitutes the live one.
Inside one file, a `res` or `pending` belongs to the `req` with the same `id` that precedes it.

## Files

| file | scenario |
|---|---|
| `handshake-ok.jsonl` | `hello`, `welcome` |
| `reject-token.jsonl`, `reject-protocol.jsonl`, `reject-owner.jsonl`, `reject-build.jsonl`, `reject-duplicate.jsonl`, `reject-retry.jsonl` | one `hello` and the `reject` with that reason |
| `request-response.jsonl` | a request answered with a result and with errors (with and without params) |
| `pending.jsonl` | a request that waits for the launcher dialog: `req`, `pending`, `res` |
| `ops.jsonl` | every operation of 5.4 but `join.failed`: its `req` and the `res` it gets when it succeeds |
| `errors.jsonl` | one `res` for every error code (`instanceMismatch`: `invite.joinHere` while the running game does not match the invite; `forbidden`: `friend.acknowledge` for a notice only the user may review, `identityChanged` or `addedInGame`) |
| `topics.jsonl` | a `state` push for every topic, with the aliases `f1`, `f2`, ... The `me` value carries `directory` (`active`, `off`, `unreachable`, `notAllowed`, `unavailable`): the state of the name directory, as `DirectoryState` in the launcher |
| `topics-me-directory.jsonl` | the `me` topic once for every value of `directory` |
| `topics-notice.jsonl` | the `friends` topic with a `notice` on an entry (`renamed` with `previousName`, `identityChanged`); an entry without a notice has no `notice` key |
| `ops-join-failed.jsonl` | `join.failed`: the mod reports that connecting to the world of `invite.joinHere` failed; the launcher answers `{}` |
| `errors-reasons.jsonl` | errors whose code is coarse and carries its cause in `params.reason` (`badRequest`, `denied`, `busy`, `directoryUnavailable`, `rateLimited`, `notFound` for a friend without a notice, `nameUnknown`), the numbers `max` and `days`, and `instanceMismatch` with the plan `verdict` and the counts `missing`, `extra` |
| `events.jsonl` | every `notify` kind and every `closing` reason |
| `hints.jsonl` | `lanOpened`, `lanClosed`, `ready`, `ping`, `pong` |
| `limits.jsonl` | the numbers of 5.3 and 5.6 |
