# Synchronization engine

This document describes how the `core` engine works, its decision rules, and the role of the `ignoreDelete` setting.

## Synchronization cycle

`SyncManager` processes a synchronization path in five steps:

1. `SyncPath.checks()` validates the local path and adapts the direction to the remote permissions, then `RequestsManager` completes the shared
   server authentication and capability negotiation.
2. `FilesParser` loads the previous snapshots, restores namespaced local download checkpoints, then inventories the local and remote contents in
   parallel.
3. `DiffParser` compares both inventories, uses the previous snapshots to detect deletions and moves, then produces an ordered list of actions.
4. `Sync` executes these actions. In report mode, `Report` exposes them without modifying any files.
5. After a successful run, the new local, remote, and incomplete-transfer snapshots are saved.

Move tasks complete before other actions are scheduled. Creations and transfers use worker queues; copies and deletions enter an end queue, while
property updates use a separate queue. These queues can overlap, so this is a scheduling priority rather than a strict global execution order.
Children of a deleted or moved directory are reduced to avoid redundant operations.

Each batch produced by `DiffParser` carries its task count directly to `Sync` or `Report`, which passes it to `TransfersManager`. Property-only
batches carry a count of zero. Task accounting therefore does not add listeners to the global core event bus. `RunManager` is likewise the sole
global listener for synchronization-stop and exit events: it keeps the active `SyncManager` instances in a registry, forwards lifecycle requests,
and removes every manager from that registry in a `finally` block.

## File inventories and snapshots

Each relative path is associated with the following tuple:

```text
[isDir, size, mtime, inode, checksum, incompleteSize?]
```

- `isDir` distinguishes files from directories;
- `size` is used for fast comparisons;
- `mtime` is used for properties and to select the most recent content;
- `inode` contributes to move detection;
- `checksum` is populated in `secure` mode;
- `incompleteSize` allows some interrupted transfers to be resumed.

Paths use `NormalizedMap`, which treats canonically equivalent Unicode representations as identical. Three snapshots are stored for each synchronized
path: local (`l`), remote (`r`), and incomplete (`i`). If the local or remote snapshots cannot be loaded, the run is considered the first
synchronization. The incomplete snapshot also stores persistent upload-session records.

Read errors prevent the engine from interpreting an item as deleted on the opposite side. Built-in and configured filters are applied on both sides.
Local download checkpoints recorded in the incomplete snapshot are tracked separately and cleaned up after their retention period. Removing a sync
path or unregistering a server also removes, on a best-effort basis, only the exact checkpoint namespace owned by that path or server.

### Resumable desktop downloads

Incoming downloads are staged under the exact reserved directory inside the synchronized local root:

```text
<local-root>/.sync-in-tmp/
└── desktop-<client-id>-sync-path-<path-id>-download-<transfer-id>.part
```

`client-id` is the persistent server authentication identifier, `path-id` is the positive synchronization-path identifier, and `transfer-id` is the
SHA-512/256 hexadecimal digest of the NFC-normalized logical relative path, with separators normalized on Windows. The fixed-length digest keeps user
basenames out of internal filenames and makes the same checkpoint deterministic across restarts.

The `.sync-in-tmp` name and its case variants are reserved and included in the default filters sent to both parsers. Other `.sync-in.*` files remain
ordinary user content. If `.sync-in-tmp` is a regular file or a symbolic link instead of a real directory, the transfer fails without replacing that
entry.

Downloads smaller than 20 MiB are not persisted for byte-range recovery. For larger files, the incomplete snapshot stores the expected remote
metadata: secure mode matches the checksum and fast mode matches both size and modification time. The actual `.part` size read with `lstat` is
authoritative for the next `Range` request. A staging file already at the expected size is validated locally and published without requesting a
range starting at end-of-file: secure mode recalculates its checksum, while fast mode validates its size. A stale saved offset never overrides the
current filesystem size.

Checkpoint restoration only manages names with the exact prefix of the current client and synchronization path. Tracked files and unreferenced owned
entries become eligible for removal after 48 hours according to local `ctime`; a tracked file larger than the expected destination is removed
immediately. An owned checkpoint name that resolves to a directory, symbolic link, or another non-regular entry is also removed immediately without
following it. Entries for another client or path, `server-user-*` entries, and unknown names are preserved.

Before publication, the remote modification time is applied to the staging file. A new file with no existing destination uses a same-filesystem
rename in the normal layout. A remote replacement allows overwriting the previous local file; `fs-extra` removes that destination before renaming,
so replacement is not atomic even on the same filesystem. New downloads disable overwriting and reject a destination observed before publication;
this is not a race-free no-clobber guarantee if another process creates the destination immediately before the final rename. If the destination is
below a nested mount, `fs-extra` v11 handles `EXDEV` by copying the file and then removing the staging file. This fallback preserves timestamps, and
the destination modification time is reapplied explicitly as a publication invariant. Cross-filesystem publication is also non-atomic: the
destination can be visible while it is copied or left incomplete if the process is interrupted.

Local move operations use the same `moveFiles()` abstraction with overwriting disabled. Files and directories can therefore cross a nested mount
through the same non-atomic `EXDEV` copy-and-remove fallback, while an existing destination causes the move to fail.

### Resumable desktop uploads

When the server advertises `capabilities.transfers`, the desktop client uploads files through the synchronization upload-session API. The legacy
single-request upload remains unchanged and is used when that capability is absent. Web upload sessions use their own existing protocol.
The first request selects an immutable mode: a global `upload-checksum` selects secure transfer, while its absence selects fast transfer.

The capability is accepted when `maxChunkSize` is either `null` or a safe integer of at least `1,000,000` bytes, matching the backend configuration
contract. An absent capability or an invalid chunk size selects the legacy route. With `maxChunkSize: null`, one logical chunk spans the complete
file. Authentication and capability negotiation complete before local inventory so secure
multi-chunk files are hashed only once during the normal path. Parallel synchronization paths share one in-flight authentication per server, then
apply the negotiated token and capability to each HTTP client. If the path that initiated authentication is stopped, another active waiter resumes
the authentication instead of inheriting that cancellation. Conversely, stopping only a waiting path cancels its local wait without interrupting
the shared server authentication.

Fast synchronization chunks contain raw file bytes and do not calculate a SHA checksum during upload. Secure synchronization chunks are framed as
follows:

```text
[file bytes][32-byte binary SHA-512/256 digest]
```

In fast mode, `Content-Length` is the number of file bytes and `upload-validated-offset` always equals `upload-offset`; the response header does not
represent or persist additional cryptographic state. In secure mode, `Content-Length` includes the digest, while `upload-length` and `upload-offset`
describe file bytes only. The server hashes the logical range while streaming it and compares the result with the client digest. It advances
`upload-validated-offset` only after they match. Publication is allowed only when both the staged and validated offsets equal `upload-length`.

In secure comparison mode, the checksum pass calculates the full-file checksum and the fixed-boundary chunk checksums together. If the full checksum
was reused from an earlier snapshot, the chunk checksums are calculated lazily before sending another data chunk and the newly calculated full
checksum must still match the snapshot. The global checksum remains immutable session metadata, while validation before publication uses the
precomputed chunk digests. A source change after parsing therefore cannot be silently published. A zero-byte file and a publication retry whose staged
and validated offsets are already equal use an empty request body in both modes.

In fast mode, an interrupted request resumes directly from the authoritative staged offset without rereading or hashing its retained prefix. Only a
secure request may leave the staged offset ahead of the validated offset. After `HEAD` recovery, the server rehashes
`[upload-validated-offset, upload-offset)` and continues the same logical chunk from the staged offset; the desktop already has the expected digest for
the complete fixed-boundary chunk. The digest appended by the retry therefore covers the retained prefix and the newly transferred bytes. This
preserves partial progress without persisting a cryptographic hash state; at most one incomplete secure chunk is reread. The server remains the source
of truth for both offsets, so the local incomplete snapshot stores only the upload identity and immutable file metadata, including the chunk size that
defines checksum boundaries and the local inode used to reject a replaced source across restarts. Secure-mode chunk digests remain an in-memory cache;
after a desktop restart they are recalculated lazily only when another chunk must be sent, and the full checksum is then revalidated before resuming.
When `HEAD` reports an already `ready` session, the desktop instead compares the current inode, size, and modification time with the parsed source and
sends the empty publication `PATCH` without rebuilding chunk checksums. An identity mismatch cancels the stale session and defers that upload. This
metadata-only shortcut is intentional: it avoids hashing the complete source again after a restart. An in-place change that preserves the inode, size,
and parsed modification time is therefore outside the integrity guarantees of this `ready` recovery path.

To keep small-file throughput independent of snapshot I/O, a newly created upload identifier is written immediately only when the file is at least
20 MiB or spans more than one logical chunk. A successful smaller mono-chunk upload therefore performs no per-file snapshot write; if such an attempt
remains unfinished, the normal end-of-run snapshot still persists it. Completed records are removed in memory and flushed with the next durable
session addition or final snapshot. Snapshot replacement uses a temporary file and rename so a process failure cannot truncate the last valid state.

When `maxChunkSize` is `null`, the secure logical chunk spans the complete file, so secure recovery may rehash the complete retained prefix. Fast
recovery still resumes directly from the staged offset.

Publication moves the staged payload to the destination and removes the backend session before returning the final response. If that response is
lost, a later `HEAD` returns `404` and cannot distinguish a completed upload from a missing session. After an established session, that response ends
the current attempt. If the publishing request was also the unconfirmed first request, the client instead retries that first request with the same
upload identifier: creation-only `POST` then returns `405` when the destination was published, while overwrite `PUT` can retransmit the file. The next
synchronization inventories the published destination as the source of truth. If it matches the local immutable file metadata, the stale local
session record is discarded without retransmission; otherwise a required upload starts a new session and may retransmit the file. This behavior is
the intentional protocol contract and does not use a completion tombstone.

Each upload-session attempt opens the source once and pins that file handle across every data chunk and authentication retry. Before each logical
upload step the desktop verifies that the opened object is still a regular file with the parsed inode, size, and modification time; the persisted
inode provides the same guard when an interrupted session is resumed after restart. Replacing or renaming the source path between chunks therefore
cannot combine bytes from two versions: the remaining chunks still read the originally opened inode. The handle is closed after success or failure.
This does not create a filesystem snapshot, so an in-place write to that same inode remains outside the guarantees of fast mode; secure mode detects
such content changes through its precomputed checksums.

Recovery from `409`, `423`, retryable connection failures, and retryable `5xx` responses uses bounded exponential backoff capped at 30 seconds. The
delay uses the synchronization instance's abort signal. Stopping synchronization or failing its main run interrupts every active upload-session
backoff immediately and propagates the original transport error, preserving resumable session state instead of treating timer cancellation as a
permanent upload failure.

## Comparison modes

The `fast` mode compares type, size, and modification time. The `secure` mode adds a checksum and can reuse a nonempty file with identical content
already present on the destination by copying it. A copy source must remain available after earlier moves, updates, and deletions; otherwise the
file is transferred.

A file ↔ directory type difference is always treated as a content difference, including between a directory and an empty file, which both have a size of
zero.

## Directions

With `ignoreDelete` set to `false`:

| Situation                          | `upload`                | `download`       | `both`                                         |
|------------------------------------|-------------------------|------------------|------------------------------------------------|
| Present only locally               | Copy to the remote side | Delete locally   | Copy remotely unless remote deletion confirmed |
| Present only remotely              | Delete remotely         | Copy locally     | Copy locally unless local deletion confirmed   |
| Different content at the same path | Local side wins         | Remote side wins | `conflictMode` decides                         |

In `both` mode, a deletion is confirmed only if the path existed in the previous snapshot of the missing side and the surviving copy has no
detected changes since its own previous snapshot. If the surviving copy changed, it is restored to the missing side instead.

During the first synchronization, `both` mode does not propagate deletions because no previous snapshot exists to distinguish an addition from a
deletion.

## `ignoreDelete`

`ignoreDelete` is a boolean independent of the synchronization direction. Its default value is `false`. A missing value, particularly in an older
configuration, is therefore treated as `false`.

When set to `true`, only decisions resulting from a path being absent are changed:

| Situation                          | `upload`                | `download`        | `both`                  |
|------------------------------------|-------------------------|-------------------|-------------------------|
| Present only locally               | Copy to the remote side | Keep locally only | Copy to the remote side |
| Present only remotely              | Keep remotely only      | Copy locally      | Copy locally            |
| Different content at the same path | Local side wins         | Remote side wins  | `conflictMode` decides  |

This behavior supports the following use cases:

- uploading files from a workstation to a NAS and then deleting them from the workstation without deleting the remote archive (`upload` +
  `ignoreDelete`);
- collecting files locally from a server or IoT device without having local cleanup delete the source (`download` + `ignoreDelete`);
- automatically restoring an item deleted on only one side in `both` mode.

### Moves

A move is detected from a deletion and an addition of the same type. In `fast` mode, their inode and size must match. In `secure` mode, files require
matching non-null checksums; directories still use inode and size because they have no checksum.

With `ignoreDelete`, the deletion part is not propagated:

- in `upload` mode, a local move copies the new path to the remote side and preserves the old remote path;
- in `download` mode, a remote move copies the new path locally and preserves the old local path;
- in `both` mode, the old path is restored from the side where it still exists and the new path is copied to the other side.

This result is intentional: a rename is decomposed into an addition and a deletion, and the deletion is precisely the part being ignored.

### File ↔ directory conflicts

`ignoreDelete` does not protect an item when a file and a directory occupy the same path. This case is a type replacement, not the propagation of an
entry marked as deleted. This scope matches Syncthing's `ignoreDelete` behavior.

- in `upload` mode, the local type replaces the remote type;
- in `download` mode, the remote type replaces the local type;
- in `both` mode, `conflictMode` selects the winning side.

The engine uses the existing replacement mechanism and does not create a `.sync-conflict-*` file.

### First synchronization

Without `ignoreDelete`, a guard blocks the first unidirectional synchronization when the source is empty and the destination is not, because the
entire destination would otherwise be deleted.

With `ignoreDelete`, this guard is unnecessary: destination-only content is preserved, so an empty source does not cause any deletion.

## Conflict resolution

`conflictMode` applies only in `both` mode when the same path exists on both sides with different content or properties:

- `local` always gives priority to the client;
- `remote` always gives priority to the server;
- `recent` selects the most recent modification time. When modification times are equal but content differs, the larger size wins, with local priority
  if the sizes are also equal.

`ignoreDelete` does not change any of these rules.

In `both` mode, when a path is deleted on one side but modified on the other, the modified copy is restored to the missing side. This case does not use
`conflictMode`.

## Configuration and compatibility

The setting is included in `SyncPath.settings()`, the local configuration, and server exchanges. Creation normalizes a missing value to `false`. A
partial update that does not provide the field preserves the current value; an explicit `false` value disables it.

From the command line:

```text
paths add ... --ignore-delete
paths set ... --ignore-delete true
paths set ... --ignore-delete false
```

When adding a path, the option defaults to `false` if omitted. During `set`, omitting the option leaves the existing configuration unchanged.
