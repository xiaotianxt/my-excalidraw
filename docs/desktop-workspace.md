# Desktop workspace: drafts are not saves

## Decision

Desktop-first. Reuse Excalidraw for drawing; own the document lifecycle and workspace. Web/PWA distribution is removed; synchronization is out of scope. Do not fork the drawing engine or migrate existing data as part of this change.

## User contract

- A **saved drawing** is updated only by Save / Cmd-or-Ctrl+S. A new drawing or a legacy workspace-only drawing asks for a native `.excalidraw` destination on its first explicit save.
- A **draft** is a recoverable working copy. Content changes are debounced by 800 ms, with a maximum scheduling delay of 5 seconds during continuous drawing. Disk latency is additional; the status indicates whether persistence has finished. This is not a guarantee against the loss of the very last edit during a force-quit or power failure.
- Selection, pointer movement, and viewport changes do not dirty a document. Unchanged documents do not have a periodic save timer.
- Returning to the workspace, opening another drawing, creating a new drawing, and normal window close/quit flush the current draft. They never implicitly commit it. If flushing fails, remain in the editor and offer retry / save a copy / stay.
- Save a copy uses a native save dialog and then continues editing that destination. The old disk file is not removed.
- Clear is a draft operation. Write an independent before-image first, then mark elements deleted through the Excalidraw history API. If protection fails, do not clear. Undo and an explicit restore button are available.
- Discard draft also creates a recovery file before removing the draft. The committed drawing is untouched.
- Workspace rename modifies only the workspace label. It does not rename the disk file, generate a thumbnail, mutate scene data, or advance the content-modified timestamp.

## Shortcuts and UI

- Cmd/Ctrl+S: explicit save.
- Cmd/Ctrl+Shift+S: save a copy and continue at the selected destination.
- Cmd/Ctrl+N / O: new / open, with draft protection before switching.
- Cmd/Ctrl+Shift+H: workspace. The visible navigation button is the primary affordance; no shortcut is required to discover it.
- Cmd+Q: native macOS quit. Cmd/Ctrl+W: native window close. Neither is repurposed as navigation.
- Escape remains available to the editor / active dialog; it never means “leave the drawing”.

The editor has a separate document bar rather than controls floating over the drawing tools. On macOS it is a draggable custom title bar (`hidden` with an explicit traffic-light position) with real native traffic-light controls; interactive controls are explicitly non-draggable. Native File/Edit menus dispatch the same commands as the in-window controls, with document/dirty/modal state controlling availability.

Workspace grid and list views show real previews. The former handwritten SVG renderer has been removed: legacy `thumbnail` fields remain untouched in saved records but are never displayed. Visible items are rendered serially using official `exportToCanvas`, which awaits fonts and images. PNG previews are content-addressed using actual element geometry/text/style, binary image contents, the background and export settings, and stored outside the drawings. Rename is absent from this key; drawing autosave never generates previews. Excalidraw is loaded on demand; React has a separate shared chunk so the large editor does not enter the initial workspace chunk.

## Persistence boundaries

The legacy `excalidraw-workspace` key remains read-only and is merged by ID with native disk records. There is no automatic migration, deletion, or startup rewrite. An explicit save writes only that document to disk and shadows its legacy ID, avoiding browser quota failures for image-heavy drawings. Labels are separate small metadata, so rename never reserializes image/scene bytes. An explicitly opened scene file is indexed as an existing committed drawing, without rewriting the source file.

New desktop state lives under `<userData>/document-state/`:

- `documents/<id>.json`: explicitly committed scene snapshots and metadata, one file per drawing.
- `document-labels.json`: explicit workspace labels, applied to both legacy and native records.
- `export-settings.json`: persisted PNG scale/DPI, embedding and background preferences.
- `drafts/<id>.json`: one working draft per document, including images and its committed fingerprint.
- `previews/<id>.json`: one disposable official-renderer PNG cache per document, tagged with its complete rendering-input hash. Failed/corrupt previews never block document recovery.
- `bindings.json`: paths selected by native dialogs and the last observed content hashes. Renderer IPC cannot supply arbitrary destination paths.
- `recovery/<id>-<uuid>.excalidraw`: independent checkpoints before clear/discard, reopenable as standard drawings.
- `recovery/<id>-previous.excalidraw`: the previous on-disk contents before replacement (one rolling previous version per document).

“File → 查看恢复副本” opens the recovery directory. Recovery checkpoints are not automatically pruned in this version; storage use can grow. They are recovery aids, not a replacement for an external backup.

Main-process writes are serialized. Destinations are written through a same-directory exclusive temporary file, flushed, and atomically renamed. Existing modes are retained and symlink targets are refused. Corrupt metadata is an error, never an empty workspace. A hash mismatch or a moved/deleted original blocks direct overwrite and offers Save a copy. This detects changes observed before saving; it is not a cross-application filesystem transaction or merge system.

The renderer owns the live scene until persistence succeeds. A disk save followed by a workspace failure is reported as **file saved / workspace incomplete**, rather than incorrectly claiming nothing was saved. A failed draft write does not prevent an emergency save to another location. Editor rendering failures leave the document controls and in-memory scene available.

## Security and offline behavior

- Context isolation + sandbox; no renderer Node integration or generic IPC bridge.
- IPC accepts only the owned window's main frame.
- Single instance per profile; navigation and child windows are denied.
- Production CSP blocks remote scripts/network requests. Excalidraw fonts are shipped locally, with the asset base configured before module evaluation. The upstream FontFace definitions still include CDN fallback candidates, which CSP rejects; local Excalifont/Xiaolai loading and font fetch for export were verified.
- Narrow dependency overrides temporarily replace vulnerable versions pinned by Excalidraw / its Mermaid dependency: nanoid 3 for Excalidraw, nanoid 5 for Mermaid, and lodash-es 4. Remove these when the upstream dependency constraints adopt fixed releases. These are dependency-level mitigations, not upstream fixes.

## Safe development / rollout

Development and unpackaged launches default to **My Excalidraw Development**, never the installed app's profile. `MY_EXCALIDRAW_DATA_DIR` can select a dedicated temporary profile for testing.

Never replace the installed application without backups and copy-based compatibility verification. Before each rollout:

1. Close the existing app with user approval.
2. Back up and verify its actual application-data directory and any external drawing files.
3. Check compatibility on a copy of that profile, including image-heavy drawings and the user's normal workload.
4. Only then agree on replacing the application. Keep the original profile and app available for rollback.

Initial development used synthetic data. The user subsequently authorized replacement after data verification. For the 2026-09-22 local 0.1.3 rollout, the closed production profile and old application were backed up and byte-verified; both real drawings (52 elements) were opened on a copy. Original content fields matched, except semantically empty `boundElements: null` values normalized to `[]` in memory. All original localStorage strings remained byte-identical through browsing, official preview generation, and startup of the installed 0.1.3 build. The app was finally relaunched without a debugging port. The previous dirty source tree was also archived outside the repository before editing.

## Verification

Automated persistence tests cover draft/file separation, restart recovery, failed writes, corrupt metadata, external-file conflicts, atomic symlink refusal, ID traversal, ordered writes, no-op detection, and metadata-only rename.

Desktop integration was exercised with an OS temporary profile, synthetic drawings, and test-only native-dialog responses: drawing and draft recovery; clear and restore; permission-denied draft writes blocking navigation; explicit save and draft cleanup; no-op Cmd+S; external conflict rejection; workspace quota failure after a successful file write; retry; normal native quit preserving the draft without committing it; and discard retaining a separate four-element recovery file while the committed three-element drawing remained unchanged. No production dialog hooks are present in source.

Image import/export additionally uses the official `loadFromBlob`, `exportToBlob` and `exportToSvg` APIs. PNG/SVG scene absence permits importing a flat image; corrupt embedded scenes fail visibly. Image imports are independent drafts and never bind Save to the source picture. Embedded exports are independent copies. PNG pHYs injection changes physical DPI only and preserves every other PNG chunk, including embedded scene data. Defaults are 2× / 300 DPI with embedding enabled. The real Electron integration check covers PNG/SVG round-trips including binary assets, flat-image fallback, native DPI writes and rejection of corrupt embedded SVG metadata.

Remaining limits: legacy records are retained even after newer disk snapshots shadow them, so rollback must also preserve/export new disk documents. No automatic old-record cleanup is performed. Large editor/diagram/font-subsetting chunks remain upstream lazy-loaded assets. Node 26 reports an upstream `@tailwindcss/node` module.register deprecation; supported development/CI baseline is Node 22 LTS. Neither warning is suppressed.
