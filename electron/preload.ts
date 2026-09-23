import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../src/document';

const desktop: DesktopAPI = {
  platform: process.platform,
  readWorkspace: () => ipcRenderer.invoke('workspace-read'),
  writeWorkspaceFile: file => ipcRenderer.invoke('workspace-write', file),
  renameWorkspaceFile: (id, name) => ipcRenderer.invoke('workspace-rename', id, name),
  getExportSettings: () => ipcRenderer.invoke('export-settings-get'),
  saveExportSettings: settings => ipcRenderer.invoke('export-settings-save', settings),
  exportImage: (name, format, bytes, dpi) => ipcRenderer.invoke('image-export', name, format, bytes, dpi),
  setMenuState: state => ipcRenderer.send('document-menu-state', state),
  getThumbnail: (id, key) => ipcRenderer.invoke('thumbnail-get', id, key),
  putThumbnail: (id, key, dataURL) => ipcRenderer.invoke('thumbnail-put', id, key, dataURL),
  listDrafts: () => ipcRenderer.invoke('draft-list'),
  writeDraft: draft => ipcRenderer.invoke('draft-write', draft),
  deleteDraft: id => ipcRenderer.invoke('draft-delete', id),
  checkpoint: draft => ipcRenderer.invoke('draft-checkpoint', draft),
  openFile: id => ipcRenderer.invoke('document-open', id),
  loadFile: id => ipcRenderer.invoke('document-load', id),
  saveFile: (id, name, scene, saveAs) => ipcRenderer.invoke('document-save', id, name, scene, saveAs),
  onCommand: listener => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on('document-command', handler);
    return () => ipcRenderer.removeListener('document-command', handler);
  },
  closeWindow: () => ipcRenderer.send('document-close-ready'),
  cancelClose: () => ipcRenderer.send('document-close-cancelled'),
};
contextBridge.exposeInMainWorld('desktop', desktop);
