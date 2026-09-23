import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopStorage, atomicWrite } from '../electron/storage';
import { emptyScene, fingerprint, type Draft, type Scene } from '../src/document';
import { WorkspaceService } from '../src/services/WorkspaceService';

const makeDraft = (id = 'test-document'): Draft => ({ id, name: 'Test', data: emptyScene(), updatedAt: 1, committedFingerprint: null });
const fixture = async (t: test.TestContext) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'my-excalidraw-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new DesktopStorage(path.join(root, 'state')) };
};

test('draft autosave leaves the committed file byte-for-byte unchanged, and survives restart', async t => {
  const { root, store } = await fixture(t);
  const original = path.join(root, 'original.excalidraw');
  await fs.writeFile(original, JSON.stringify(emptyScene()));
  await store.openFile('test-document', original);
  const before = await fs.readFile(original);
  const stat = await fs.stat(original);
  const draft = makeDraft();
  draft.data.appState.viewBackgroundColor = '#123456';
  await store.writeDraft(draft);
  assert.deepEqual(await fs.readFile(original), before);
  assert.equal((await fs.stat(original)).mtimeMs, stat.mtimeMs);
  assert.deepEqual(await new DesktopStorage(path.join(root, 'state')).listDrafts(), [draft]);
});

test('explicit save replaces one file and retains its previous contents', async t => {
  const { root, store } = await fixture(t);
  const original = path.join(root, 'original.excalidraw');
  const initial = JSON.stringify(emptyScene());
  await fs.writeFile(original, initial);
  await store.openFile('test-document', original);
  const draft = makeDraft();
  draft.data.appState.viewBackgroundColor = '#123456';
  await store.saveFile(draft.id, draft.data);
  assert.equal(JSON.parse(await fs.readFile(original, 'utf8')).appState.viewBackgroundColor, '#123456');
  assert.equal(await fs.readFile(path.join(root, 'state/recovery/test-document-previous.excalidraw'), 'utf8'), initial);
});

test('external changes block overwrite but permit saving a separate copy', async t => {
  const { root, store } = await fixture(t);
  const original = path.join(root, 'original.excalidraw');
  await fs.writeFile(original, JSON.stringify(emptyScene()));
  await store.openFile('test-document', original);
  await fs.writeFile(original, 'changed elsewhere');
  await assert.rejects(store.saveFile('test-document', emptyScene()), /其他应用/);
  assert.equal(await fs.readFile(original, 'utf8'), 'changed elsewhere');
  await store.saveFile('test-document', emptyScene(), path.join(root, 'copy.excalidraw'));
  assert.equal(await fs.readFile(original, 'utf8'), 'changed elsewhere');
});

test('a failed save does not remove the recoverable draft', async t => {
  const { root, store } = await fixture(t);
  await store.writeDraft(makeDraft());
  await assert.rejects(store.saveFile('test-document', emptyScene(), path.join(root, 'missing/file.excalidraw')));
  assert.deepEqual(await store.listDrafts(), [makeDraft()]);
});

test('corrupt drafts and bindings fail closed, rather than appearing empty', async t => {
  const { root, store } = await fixture(t);
  await store.writeDraft(makeDraft());
  await fs.writeFile(path.join(root, 'state/drafts/test-document.json'), '{broken');
  await assert.rejects(store.listDrafts());
  await fs.writeFile(path.join(root, 'state/bindings.json'), '{broken');
  const output = path.join(root, 'output.excalidraw');
  await assert.rejects(store.saveFile('test-document', emptyScene(), output));
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('checkpoint is independently recoverable in the normal file format', async t => {
  const { store } = await fixture(t);
  await store.checkpoint(makeDraft());
  const directory = await store.recoveryDirectory();
  const [name] = await fs.readdir(directory);
  const recovered = await store.openFile('recovered', path.join(directory, name));
  assert.deepEqual(recovered.data.elements, []);
  assert.equal(recovered.data.appState.viewBackgroundColor, '#ffffff');
});

test('queued draft writes preserve the latest version', async t => {
  const { store } = await fixture(t);
  await Promise.all([store.writeDraft(makeDraft()), store.writeDraft({ ...makeDraft(), name: 'Latest' })]);
  assert.equal((await store.listDrafts())[0].name, 'Latest');
});

test('atomic writer refuses a symlink and leaves its target intact', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'target'), 'original');
  await fs.symlink(path.join(root, 'target'), path.join(root, 'link'));
  await assert.rejects(atomicWrite(path.join(root, 'link'), 'replacement'));
  assert.equal(await fs.readFile(path.join(root, 'target'), 'utf8'), 'original');
});

test('invalid document IDs cannot escape the draft directory', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.writeDraft(makeDraft('../outside')));
  await assert.rejects(store.deleteDraft('../outside'));
});

test('selection and viewport changes do not dirty a scene; content changes do', () => {
  const scene = emptyScene();
  const moved = { ...scene, appState: { ...scene.appState, scrollX: 100, scrollY: 50, selectedElementIds: { x: true } } } as Scene;
  assert.equal(fingerprint(scene), fingerprint(moved));
  assert.notEqual(fingerprint(scene), fingerprint({ ...scene, appState: { ...scene.appState, viewBackgroundColor: '#000000' } }));
});

test('workspace read errors block commits without touching original bytes', async () => {
  let raw = '{broken';
  let writes = 0;
  const service = new WorkspaceService({ getItem: () => raw, setItem: (_key, value) => { raw = value; writes++; } });
  await assert.rejects(service.getAllFiles());
  await assert.rejects(service.saveToWorkspace('new', [], {}, {}));
  assert.equal(writes, 0);
  assert.equal(raw, '{broken');
});

test('renaming uses small metadata, retaining legacy bytes, scenes and content timestamps', async t => {
  const { root, store } = await fixture(t);
  const saved = { id: 'existing', name: 'Original', createdAt: 1, updatedAt: 2, thumbnail: 'thumbnail', size: 3, elementCount: 0, data: emptyScene() };
  const raw = JSON.stringify([saved]);
  const service = new WorkspaceService({ getItem: () => raw, setItem: () => { throw Error('Legacy data must be read-only'); } }, () => store);
  await service.renameFile('existing', 'Original');
  await assert.rejects(fs.stat(path.join(root, 'state/document-labels.json')), { code: 'ENOENT' });
  await service.renameFile('existing', 'Renamed');
  assert.deepEqual(await service.getAllFiles(), [{ ...saved, name: 'Renamed' }]);
  assert.deepEqual(await fs.readdir(path.join(root, 'state/documents')), []);
  await store.writeWorkspaceFile(saved);
  const filename = path.join(root, 'state/documents/existing.json');
  const before = await fs.readFile(filename);
  await service.renameFile('existing', 'Another label');
  assert.deepEqual(await fs.readFile(filename), before);
});

test('large committed scenes go to disk and shadow only their legacy ID', async t => {
  const { store } = await fixture(t);
  const saved = { id: 'existing', name: 'Original', createdAt: 1, updatedAt: 2, size: 3, elementCount: 0, data: emptyScene() };
  const raw = JSON.stringify([saved]);
  const service = new WorkspaceService({ getItem: () => raw, setItem: () => { throw Error('Simulated browser quota exceeded'); } }, () => store);
  const imageFiles = { image: { id: 'image', mimeType: 'image/png', dataURL: `data:image/png;base64,${'A'.repeat(2_000_000)}`, created: 1 } } as Scene['files'];
  await service.saveToWorkspace('New version', [], {}, imageFiles, 'existing');
  const files = await service.getAllFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0].createdAt, 1);
  assert.deepEqual(files[0].data.files, imageFiles);
  assert.deepEqual(JSON.parse(raw), [saved]);
});

test('thumbnail cache is independent of drafts and only serves the matching content version', async t => {
  const { root, store } = await fixture(t);
  await store.writeDraft(makeDraft());
  const draftPath = path.join(root, 'state/drafts/test-document.json');
  const before = await fs.readFile(draftPath);
  const key = 'a'.repeat(64);
  const image = 'data:image/png;base64,dGVzdA==';
  await store.putThumbnail('test-document', key, image);
  assert.equal(await store.getThumbnail('test-document', key), image);
  assert.equal(await store.getThumbnail('test-document', 'b'.repeat(64)), null);
  assert.deepEqual(await fs.readFile(draftPath), before);
  await store.putThumbnail('test-document', 'b'.repeat(64), image);
  assert.equal((await fs.readdir(path.join(root, 'state/previews'))).length, 1);
});

test('a corrupt disposable preview does not prevent draft recovery', async t => {
  const { root, store } = await fixture(t);
  await store.writeDraft(makeDraft());
  await fs.mkdir(path.join(root, 'state/previews'));
  await fs.writeFile(path.join(root, 'state/previews/test-document.json'), '{broken');
  assert.equal(await store.getThumbnail('test-document', 'a'.repeat(64)), null);
  assert.deepEqual(await store.listDrafts(), [makeDraft()]);
  await assert.rejects(store.putThumbnail('../escape', 'a'.repeat(64), 'data:image/png;base64,dGVzdA=='));
});
