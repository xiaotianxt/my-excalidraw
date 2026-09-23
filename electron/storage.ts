import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileFormat, type Draft, type Scene } from '../src/document';
import { defaultExportSettings, validateExportSettings, type ExportSettings } from '../src/image-format';
import type { WorkspaceFile } from '../src/services/WorkspaceService';

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function validateId(id: string) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('无效的绘图 ID');
}

export function validateScene(value: unknown): asserts value is Scene {
  const scene = value as Scene;
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.elements) ||
      !scene.appState || typeof scene.appState !== 'object' || Array.isArray(scene.appState) ||
      !scene.files || typeof scene.files !== 'object' || Array.isArray(scene.files) ||
      scene.elements.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.version !== 'number')) {
    throw new Error('文件不是有效的 Excalidraw 绘图，未对原文件做任何修改。');
  }
}

// Same-directory replacement: a failed write cannot truncate the destination.
export async function atomicWrite(destination: string, contents: string | Uint8Array) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  let mode = 0o600;
  try {
    const stat = await fs.lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('保存目标不是普通文件，请另存副本。');
    mode = stat.mode & 0o777;
  } catch (error) { if (!missing(error)) throw error; }
  const handle = await fs.open(temporary, 'wx', mode);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, destination);
  } finally {
    await handle.close().catch(() => undefined);
    await fs.unlink(temporary).catch(error => { if (!missing(error)) throw error; });
  }
}

type Binding = { filePath: string; hash: string };

export class DesktopStorage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}

  // All draft, checkpoint and committed writes are ordered in the owner process.
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async directory(name: string) {
    const directory = path.join(this.root, name);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  private async bindings(): Promise<Record<string, Binding>> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.root, 'bindings.json'), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.values(value).some(item => !item || typeof (item as Binding).filePath !== 'string' || typeof (item as Binding).hash !== 'string')) {
        throw new Error('文件关联记录损坏；请保留现场并恢复备份。');
      }
      return value;
    } catch (error) { if (missing(error)) return {}; throw error; }
  }

  private async bind(id: string, binding: Binding) {
    const bindings = await this.bindings();
    if (bindings[id]?.filePath === binding.filePath && bindings[id]?.hash === binding.hash) return;
    bindings[id] = binding;
    await this.directory('');
    await atomicWrite(path.join(this.root, 'bindings.json'), JSON.stringify(bindings));
  }

  async listDrafts(): Promise<Draft[]> {
    await this.tail;
    const directory = await this.directory('drafts');
    return Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(async name => {
      const draft: Draft = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
      validateId(draft.id);
      validateScene(draft.data);
      if (name !== `${draft.id}.json` || typeof draft.name !== 'string' || typeof draft.updatedAt !== 'number' ||
          !(draft.committedFingerprint === null || typeof draft.committedFingerprint === 'string')) {
        throw new Error(`草稿 ${name} 无法读取，未删除或覆盖它。`);
      }
      return draft;
    }));
  }

  writeDraft(draft: Draft) {
    return this.run(async () => {
      validateId(draft.id);
      validateScene(draft.data);
      const directory = await this.directory('drafts');
      await atomicWrite(path.join(directory, `${draft.id}.json`), JSON.stringify(draft));
    });
  }

  checkpoint(draft: Draft) {
    return this.run(async () => {
      validateId(draft.id);
      validateScene(draft.data);
      const directory = await this.directory('recovery');
      await atomicWrite(path.join(directory, `${draft.id}-${randomUUID()}.excalidraw`), JSON.stringify(fileFormat(draft.data)));
    });
  }

  private async documentNames(): Promise<Record<string, string>> {
    try {
      const names = JSON.parse(await fs.readFile(path.join(this.root, 'document-labels.json'), 'utf8'));
      if (!names || typeof names !== 'object' || Array.isArray(names) || Object.values(names).some(name => typeof name !== 'string')) throw new Error('绘图名称记录损坏，已停止写入。');
      for (const id of Object.keys(names)) validateId(id);
      return names;
    } catch (error) { if (missing(error)) return {}; throw error; }
  }

  async readWorkspace(): Promise<{ files: WorkspaceFile[]; names: Record<string, string> }> {
    await this.tail;
    const directory = await this.directory('documents');
    const files = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(async name => {
      const file = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as WorkspaceFile;
      validateId(file.id);
      validateScene(file.data);
      if (name !== `${file.id}.json` || typeof file.name !== 'string' || !Number.isFinite(file.updatedAt)) throw new Error('工作区文件损坏，未覆盖或删除。');
      return file;
    }));
    return { files, names: await this.documentNames() };
  }

  writeWorkspaceFile(file: WorkspaceFile) {
    return this.run(async () => {
      validateId(file.id); validateScene(file.data);
      if (typeof file.name !== 'string' || !Number.isFinite(file.updatedAt)) throw new Error('工作区文件无效。');
      const directory = await this.directory('documents');
      await atomicWrite(path.join(directory, `${file.id}.json`), JSON.stringify(file));
    });
  }

  renameWorkspaceFile(id: string, name: string) {
    return this.run(async () => {
      validateId(id);
      if (typeof name !== 'string' || !name.trim()) throw new Error('名称不能为空。');
      const names = await this.documentNames();
      if (names[id] === name.trim()) return;
      names[id] = name.trim();
      await this.directory('');
      await atomicWrite(path.join(this.root, 'document-labels.json'), JSON.stringify(names));
    });
  }

  async getExportSettings(): Promise<ExportSettings> {
    await this.tail;
    try {
      const settings = JSON.parse(await fs.readFile(path.join(this.root, 'export-settings.json'), 'utf8'));
      validateExportSettings(settings);
      return settings;
    } catch (error) { if (missing(error)) return { ...defaultExportSettings }; throw error; }
  }

  saveExportSettings(settings: ExportSettings) {
    return this.run(async () => {
      validateExportSettings(settings);
      await this.directory('');
      const filename = path.join(this.root, 'export-settings.json');
      const contents = JSON.stringify(settings);
      let previous: string | undefined;
      try { previous = await fs.readFile(filename, 'utf8'); } catch (error) { if (!missing(error)) throw error; }
      if (previous !== contents) await atomicWrite(filename, contents);
    });
  }

  exportImage(destination: string, bytes: Uint8Array) {
    return this.run(async () => {
      let previous: Buffer | undefined;
      try { previous = await fs.readFile(destination); } catch (error) { if (!missing(error)) throw error; }
      if (previous) {
        const directory = await this.directory('recovery');
        await atomicWrite(path.join(directory, `export-${randomUUID()}${path.extname(destination)}`), previous);
      }
      await atomicWrite(destination, bytes);
      return { filePath: destination };
    });
  }

  async getThumbnail(id: string, key: string): Promise<string | null> {
    validateId(id);
    try {
      const cached = JSON.parse(await fs.readFile(path.join(this.root, 'previews', `${id}.json`), 'utf8'));
      return cached.key === key && typeof cached.dataURL === 'string' && cached.dataURL.startsWith('data:image/png;base64,') ? cached.dataURL : null;
    } catch (error) {
      // Previews are disposable, unlike document/draft records.
      if (missing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  putThumbnail(id: string, key: string, dataURL: string) {
    return this.run(async () => {
      validateId(id);
      if (!/^[a-f0-9]{64}$/.test(key) || !dataURL.startsWith('data:image/png;base64,') || dataURL.length > 2_000_000) throw new Error('无效的缩略图缓存');
      const directory = await this.directory('previews');
      await atomicWrite(path.join(directory, `${id}.json`), JSON.stringify({ key, dataURL }));
    });
  }

  recoveryDirectory() { return this.directory('recovery'); }

  deleteDraft(id: string) {
    return this.run(async () => {
      validateId(id);
      await fs.unlink(path.join(this.root, 'drafts', `${id}.json`)).catch(error => { if (!missing(error)) throw error; });
    });
  }

  openFile(id: string, filePath: string) {
    return this.run(async () => {
      validateId(id);
      const text = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(text);
      validateScene(data);
      await this.bind(id, { filePath, hash: digest(text) });
      return { data: data as Scene, filePath };
    });
  }

  async getPath(id: string): Promise<string | undefined> {
    validateId(id);
    await this.tail;
    return (await this.bindings())[id]?.filePath;
  }

  // destination is supplied ONLY by the native file picker, never by renderer IPC.
  saveFile(id: string, scene: Scene, destination?: string) {
    return this.run(async () => {
      validateId(id);
      validateScene(scene);
      const binding = (await this.bindings())[id];
      const filePath = destination ?? binding?.filePath;
      if (!filePath) throw new Error('请先选择保存位置。');
      let previous: string | undefined;
      try { previous = await fs.readFile(filePath, 'utf8'); }
      catch (error) { if (!missing(error)) throw error; }
      if (binding?.filePath === filePath && (previous === undefined || digest(previous) !== binding.hash)) {
        throw new Error('原文件已被其他应用修改或移动。为避免覆盖，请另存副本，或重新打开原文件。');
      }
      if (previous !== undefined) {
        const directory = await this.directory('recovery');
        await atomicWrite(path.join(directory, `${id}-previous.excalidraw`), previous);
      }
      const contents = JSON.stringify(fileFormat(scene));
      await atomicWrite(filePath, contents);
      try { await this.bind(id, { filePath, hash: digest(contents) }); }
      catch (error) {
        return { filePath, warning: `绘图已写入，但保存位置关联失败。下次请另存副本。${error instanceof Error ? error.message : String(error)}` };
      }
      return { filePath };
    });
  }
}
