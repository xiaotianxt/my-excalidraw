import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { imageMimeTypes, type ExportSettings } from '../src/image-format';
import { withPngDpi } from './png';
import type { WorkspaceFile } from '../src/services/WorkspaceService';
import { DesktopStorage } from './storage';
import type { Draft, Scene, MenuState } from '../src/document';

const directory = path.dirname(fileURLToPath(import.meta.url));
const devURL = process.env.VITE_DEV_SERVER_URL;
// Development must never open the installed application's profile.
if (process.env.MY_EXCALIDRAW_DATA_DIR) app.setPath('userData', path.resolve(process.env.MY_EXCALIDRAW_DATA_DIR));
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'My Excalidraw Development'));

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let win: BrowserWindow | null = null;
let closeAllowed = false;
let quitting = false;
const storage = new DesktopStorage(path.join(app.getPath('userData'), 'document-state'));
const command = (name: string) => win?.webContents.send('document-command', name);

function createWindow() {
  closeAllowed = false;
  win = new BrowserWindow({
    width: 1280, height: 850, minWidth: 760, minHeight: 520,
    backgroundColor: '#ffffff', show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 25 } } : {}),
    webPreferences: { preload: path.join(directory, 'preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => {
    win?.show();
    if (process.platform === 'darwin') win?.setWindowButtonVisibility(true);
  });
  win.on('close', event => {
    if (!closeAllowed) { event.preventDefault(); command('close'); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (devURL) void win.loadURL(devURL);
  else void win.loadFile(path.join(directory, '../dist/index.html'));
}

// Expose only named operations, and only to our window's main frame.
function handle(channel: string, handler: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('不允许的请求');
    return handler(...args as never[]);
  });
}
handle('workspace-read', () => storage.readWorkspace());
handle('workspace-write', (file: WorkspaceFile) => storage.writeWorkspaceFile(file));
handle('workspace-rename', (id: string, name: string) => storage.renameWorkspaceFile(id, name));
handle('export-settings-get', () => storage.getExportSettings());
handle('export-settings-save', (settings: ExportSettings) => storage.saveExportSettings(settings));
handle('image-export', async (name: string, format: 'png' | 'svg', bytes: Uint8Array, dpi: number) => {
  if (!['png', 'svg'].includes(format) || !(bytes instanceof Uint8Array) || bytes.length > 128 * 1024 * 1024) throw new Error('导出图像格式无效或文件过大。');
  const output = format === 'png' ? withPngDpi(bytes, dpi) : bytes;
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: `${name.replace(/[\\/:]/g, '-')}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (path.extname(result.filePath).toLowerCase() !== `.${format}`) throw new Error(`请使用 .${format} 扩展名。`);
  return storage.exportImage(result.filePath, output);
});
handle('thumbnail-get', (id: string, key: string) => storage.getThumbnail(id, key));
handle('thumbnail-put', (id: string, key: string, dataURL: string) => storage.putThumbnail(id, key, dataURL));
handle('draft-list', () => storage.listDrafts());
handle('draft-write', (draft: Draft) => storage.writeDraft(draft));
handle('draft-delete', (id: string) => storage.deleteDraft(id));
handle('draft-checkpoint', (draft: Draft) => storage.checkpoint(draft));
handle('document-load', async (id: string) => {
  const filePath = await storage.getPath(id);
  return filePath ? storage.openFile(id, filePath) : null;
});
handle('document-open', async (id: string) => {
  const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [
    { name: '绘图和图片', extensions: ['excalidraw', 'json', ...Object.keys(imageMimeTypes).map(extension => extension.slice(1))] },
  ] });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const mimeType = imageMimeTypes[path.extname(filePath).toLowerCase() as keyof typeof imageMimeTypes];
  if (mimeType) {
    const file = await fs.open(filePath, 'r');
    try {
      if ((await file.stat()).size > 64 * 1024 * 1024) throw new Error('图片文件超过 64 MB，请先减小文件。');
      return { kind: 'image', bytes: new Uint8Array(await file.readFile()), mimeType, filePath };
    } finally { await file.close(); }
  }
  return { kind: 'scene', ...await storage.openFile(id, filePath) };
});
handle('document-save', async (id: string, name: string, scene: Scene, saveAs: boolean) => {
  const existing = await storage.getPath(id);
  if (existing && !saveAs) return storage.saveFile(id, scene);
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: existing ?? `${name.replace(/[\\/:]/g, '-')}.excalidraw`,
    filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
  });
  return result.canceled || !result.filePath ? null : storage.saveFile(id, scene, result.filePath);
});
ipcMain.on('document-menu-state', (event, state: MenuState) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !state ||
      [state.documentOpen, state.dirty, state.busy, state.canClear].some(value => typeof value !== 'boolean')) return;
  const enabled: Record<string, boolean> = {
    new: !state.busy, open: !state.busy,
    save: state.documentOpen && state.dirty && !state.busy,
    'save-as': state.documentOpen && !state.busy,
    export: state.documentOpen && state.canClear && !state.busy,
    'export-settings': !state.busy,
    rename: state.documentOpen && !state.busy,
    workspace: state.documentOpen && !state.busy,
    clear: state.documentOpen && state.canClear && !state.busy,
    discard: state.documentOpen && state.dirty && !state.busy,
  };
  for (const [id, value] of Object.entries(enabled)) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item) item.enabled = value;
  }
});
ipcMain.on('document-close-cancelled', event => {
  if (win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) quitting = false;
});
ipcMain.on('document-close-ready', event => {
  if (win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) {
    closeAllowed = true;
    if (quitting) app.quit(); else win.close();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [
      { id: 'new', label: '新建绘图', accelerator: 'CmdOrCtrl+N', click: () => command('new') },
      { id: 'open', label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => command('open') },
      { type: 'separator' },
      { id: 'save', label: '保存', enabled: false, accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { id: 'save-as', label: '另存副本…', enabled: false, accelerator: 'CmdOrCtrl+Shift+S', click: () => command('save-as') },
      { id: 'export', label: '导出图像…', enabled: false, accelerator: 'CmdOrCtrl+Shift+E', click: () => command('export') },
      { id: 'export-settings', label: '默认导出设置…', click: () => command('export-settings') },
      { id: 'rename', label: '重命名绘图…', enabled: false, click: () => command('rename') },
      { id: 'discard', label: '放弃草稿…', enabled: false, click: () => command('discard') },
      { type: 'separator' },
      { id: 'workspace', label: '返回工作区', enabled: false, accelerator: 'CmdOrCtrl+Shift+H', click: () => command('workspace') },
      { label: '查看恢复副本', click: async () => { await shell.openPath(await storage.recoveryDirectory()); } },
      { role: 'close', label: '关闭窗口' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
      { role: 'selectAll', label: '全选' },
      { type: 'separator' },
      { id: 'clear', label: '清空当前草稿…', enabled: false, click: () => command('clear') },
    ] },
    { label: '显示', submenu: [
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大界面' },
      { role: 'zoomOut', label: '缩小界面' },
      { role: 'togglefullscreen', label: '全屏' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
    ] },
    { role: 'windowMenu', label: '窗口' },
  ]));
  if (primaryInstance) createWindow();
});
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
