import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withPngDpi } from '../electron/png';
import { DesktopStorage } from '../electron/storage';
import { defaultExportSettings } from '../src/image-format';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2p0AAAAASUVORK5CYII=', 'base64');
function chunks(data: Buffer) {
  const result: { type: string; bytes: Buffer }[] = [];
  for (let i = 8; i < data.length;) {
    const end = i + data.readUInt32BE(i) + 12;
    result.push({ type: data.toString('ascii', i + 4, i + 8), bytes: data.subarray(i, end) });
    i = end;
  }
  return result;
}

test('PNG DPI is physical metadata, not resampling; existing chunks stay exact', () => {
  const output = withPngDpi(png, 300);
  assert.deepEqual(chunks(output).filter(chunk => chunk.type !== 'pHYs'), chunks(png));
  const physical = chunks(output).find(chunk => chunk.type === 'pHYs')!.bytes;
  assert.equal(physical.readUInt32BE(8), 11811);
  assert.equal(physical.readUInt32BE(12), 11811);
  assert.equal(physical[16], 1);
  assert.equal(physical.readUInt32BE(17), 0x78a53f76); // known CRC of 300 DPI pHYs
  const replaced = chunks(withPngDpi(output, 600)).filter(chunk => chunk.type === 'pHYs');
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].bytes.readUInt32BE(8), 23622);
});

test('bad PNG input and unsafe DPI are rejected', () => {
  assert.throws(() => withPngDpi(Buffer.from('not png'), 300));
  assert.throws(() => withPngDpi(png.subarray(0, 30), 300));
  assert.throws(() => withPngDpi(png, 0));
  assert.throws(() => withPngDpi(png, NaN));
});

test('export defaults survive restart and overwrite exports retain a recovery copy', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'excalidraw-export-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new DesktopStorage(path.join(root, 'state'));
  assert.deepEqual(await store.getExportSettings(), defaultExportSettings);
  const settings = { ...defaultExportSettings, scale: 3, dpi: 600 };
  await store.saveExportSettings(settings);
  assert.deepEqual(await new DesktopStorage(path.join(root, 'state')).getExportSettings(), settings);
  const target = path.join(root, 'drawing.png');
  await fs.writeFile(target, png);
  const output = withPngDpi(png, settings.dpi);
  await store.exportImage(target, output);
  assert.deepEqual(await fs.readFile(target), output);
  const recovery = await store.recoveryDirectory();
  const [name] = await fs.readdir(recovery);
  assert.deepEqual(await fs.readFile(path.join(recovery, name)), png);
  await assert.rejects(store.saveExportSettings({ ...settings, scale: 100 }));
});
