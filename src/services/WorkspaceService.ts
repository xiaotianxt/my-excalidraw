import type { Scene, DesktopAPI } from '../document';

export interface FileMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  size: number;
  elementCount: number;
  filePath?: string;
}
export interface WorkspaceFile extends FileMetadata { data: Scene }
export interface WorkspaceConfig {
  recentFiles: string[];
  favoriteFiles: string[];
  sortBy: 'name' | 'createdAt' | 'updatedAt' | 'size';
  sortOrder: 'asc' | 'desc';
  viewMode: 'grid' | 'list';
}

// Legacy drawings are read-only. Explicit new saves shadow the corresponding ID
// with a disk document, without bulk migration or the browser quota ceiling.
export class WorkspaceService {
  private readonly storageKey = 'excalidraw-workspace';
  private readonly configKey = 'excalidraw-workspace-config';
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
    private desktop: () => Pick<DesktopAPI, 'readWorkspace' | 'writeWorkspaceFile' | 'renameWorkspaceFile'> = () => window.desktop,
  ) {}

  private read(): WorkspaceFile[] {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return [];
    const files = JSON.parse(raw);
    if (!Array.isArray(files) || files.some(file => !file || typeof file.id !== 'string' || typeof file.name !== 'string' || !Array.isArray(file.data?.elements) || !file.data.appState || typeof file.data.appState !== 'object' || !file.data.files || typeof file.data.files !== 'object')) {
      throw new Error('工作区无法读取。已停止写入，原数据保持不变。');
    }
    return files;
  }

  async getAllFiles(): Promise<WorkspaceFile[]> {
    const legacy = this.read();
    const saved = await this.desktop().readWorkspace();
    const merged = new Map(legacy.map(file => [file.id, file]));
    for (const file of saved.files) merged.set(file.id, file);
    return [...merged.values()].map(file => ({ ...file, name: saved.names[file.id] ?? file.name })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveToWorkspace(name: string, elements: Scene['elements'], appState: Scene['appState'], files: Scene['files'], id: string = crypto.randomUUID(), filePath?: string): Promise<string> {
    const all = await this.getAllFiles();
    const index = all.findIndex(file => file.id === id);
    const previous = all[index];
    const now = Date.now();
    const data = { elements, appState, files };
    const file: WorkspaceFile = {
      id, name, createdAt: previous?.createdAt ?? now, updatedAt: now,
      size: new Blob([JSON.stringify(data)]).size,
      elementCount: elements.filter(element => !element.isDeleted).length,
      data, filePath: filePath ?? previous?.filePath,
    };
    await this.desktop().writeWorkspaceFile(file);
    return id;
  }

  async renameFile(id: string, name: string): Promise<boolean> {
    const files = await this.getAllFiles();
    const file = files.find(item => item.id === id);
    if (!file) throw new Error('绘图不存在，请刷新工作区。');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('名称不能为空。');
    if (trimmed === file.name) return true;
    // Labels are separate metadata. Do not rewrite scene/image bytes on rename.
    await this.desktop().renameWorkspaceFile(id, trimmed);
    return true;
  }

  async getConfig(): Promise<WorkspaceConfig> {
    const raw = this.storage.getItem(this.configKey);
    return raw ? JSON.parse(raw) : { recentFiles: [], favoriteFiles: [], sortBy: 'updatedAt', sortOrder: 'desc', viewMode: 'list' };
  }

  async saveConfig(config: WorkspaceConfig): Promise<void> {
    this.storage.setItem(this.configKey, JSON.stringify(config));
  }
}
export const workspaceService = new WorkspaceService({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
