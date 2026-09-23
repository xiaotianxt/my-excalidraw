# Desktop releases

## Prepare

1. Use Node 22 and `npm ci`.
2. Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and `docs/releases/vX.Y.Z.md` in the release change.
3. Run `npm run type-check`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:images` on a desktop host. The image test launches a fresh Electron process with an OS temporary profile and ephemeral debug ports, then cleans up.
4. Review, sign commits normally, push and merge the change into `main` after CI passes.

## Publish

From a clean `main` matching `origin/main`:

```bash
./scripts/release.sh 0.1.3
```

The script checks the package version and release notes, refuses existing tags, and pushes an annotated version tag. It does not edit versions, stage arbitrary files, or bypass Git signing configuration.

`Desktop Release` builds:

- macOS arm64 and x64 DMGs
- Windows x64 NSIS installer
- Linux x64 AppImage and deb

All builds must pass before publication. The publisher verifies all five installer names, generates SHA-256 checksums, uploads into a draft release, then makes it public. Manual workflow dispatch builds artifacts only; it does not publish a release.

If a build fails, fix the cause before releasing. Never publish a partially successful matrix or silently move a published tag. A failed asset upload may leave a draft release; inspect it before resuming the publish job.

## Local packaging

```bash
npm run dist:mac -- --arm64
npm run dist:mac -- --x64
npm run dist:win
npm run dist:linux
```

Outputs go to `release/`, never the renderer's `dist/` directory. These commands do not publish or install.

## Signing

Local builds use the normal available signing identity. CI currently has no distribution-signing or notarization credentials, so public artifacts are explicitly documented as unsigned/unnotarized. Configure a real distribution certificate and notarization workflow before claiming trusted distribution signing; never export private credentials into the repository or disable Gatekeeper globally.

## Data safety

Before replacing an installed app, close it normally, verify backups of both the app and its data, and check compatibility using a copied profile. Keep rollback copies. Never point automated tests at a real profile. Newer drafts/documents may need to be exported before rolling back to an older binary.
