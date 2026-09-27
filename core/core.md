# Synchronization engine

This document describes how the `core` engine works, its decision rules, and the role of the `ignoreDelete` setting.

## Synchronization cycle

`SyncManager` processes a synchronization path in five steps:

1. `SyncPath.checks()` validates the local path and adapts the direction to the remote permissions.
2. `FilesParser` loads the previous snapshots, then inventories the local and remote contents in parallel.
3. `DiffParser` compares both inventories, uses the previous snapshots to detect deletions and moves, then produces an ordered list of actions.
4. `Sync` executes these actions. In report mode, `Report` exposes them without modifying any files.
5. After a successful run, the new local, remote, and incomplete-transfer snapshots are saved.

Move tasks complete before other actions are scheduled. Creations and transfers use worker queues; copies and deletions enter an end queue, while
property updates use a separate queue. These queues can overlap, so this is a scheduling priority rather than a strict global execution order.
Children of a deleted or moved directory are reduced to avoid redundant operations.

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
synchronization.

Read errors prevent the engine from interpreting an item as deleted on the opposite side. Built-in and configured filters are applied on both sides.
Temporary `.sync-in.*` files are tracked separately and cleaned up after their retention period.

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
