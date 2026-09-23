import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { WorkspaceFile } from './services/WorkspaceService';
import type { ExportSettings, ImageMime } from './image-format';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export interface Scene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export interface Draft {
  id: string;
  name: string;
  data: Scene;
  updatedAt: number;
  // The committed fingerprint is retained across recovery, not reset to the draft.
  committedFingerprint: string | null;
}

export interface OpenDocument extends Draft {
  filePath?: string;
}

export function sceneData(elements: readonly ExcalidrawElement[], state: Partial<AppState>, files: BinaryFiles): Scene {
  return {
    elements,
    appState: {
      viewBackgroundColor: state.viewBackgroundColor ?? '#ffffff',
      gridSize: state.gridSize ?? 20,
      gridStep: state.gridStep ?? 5,
      gridModeEnabled: state.gridModeEnabled ?? false,
      scrollX: state.scrollX ?? 0,
      scrollY: state.scrollY ?? 0,
      zoom: state.zoom ?? { value: 1 as NonNullable<AppState['zoom']>['value'] },
    },
    files,
  };
}

export const emptyScene = (): Scene => sceneData([], {}, {});

// Excalidraw file IDs are content-addressed. Never stringify image payloads on
// pointer/selection events; element versions identify actual content changes.
export function fingerprint(scene: Scene): string {
  return JSON.stringify([
    scene.elements.map(e => [e.id, e.version, e.versionNonce, e.isDeleted]),
    scene.appState.viewBackgroundColor ?? '#ffffff',
    scene.appState.gridModeEnabled ?? false,
    scene.appState.gridSize ?? 20,
    scene.appState.gridStep ?? 5,
    Object.keys(scene.files).sort(),
  ]);
}

export function fileFormat(scene: Scene) {
  return { type: 'excalidraw', version: 2, source: 'my-excalidraw', ...scene };
}

export function isDirty(document: OpenDocument): boolean {
  return document.committedFingerprint !== fingerprint(document.data);
}

export interface MenuState {
  documentOpen: boolean;
  dirty: boolean;
  busy: boolean;
  canClear: boolean;
}

export type OpenFileResult = { kind: 'scene'; data: Scene; filePath: string } |
  { kind: 'image'; bytes: Uint8Array; mimeType: ImageMime; filePath: string };

export interface DesktopAPI {
  readWorkspace(): Promise<{ files: WorkspaceFile[]; names: Record<string, string> }>;
  writeWorkspaceFile(file: WorkspaceFile): Promise<void>;
  renameWorkspaceFile(id: string, name: string): Promise<void>;
  getExportSettings(): Promise<ExportSettings>;
  saveExportSettings(settings: ExportSettings): Promise<void>;
  exportImage(name: string, format: 'png' | 'svg', bytes: Uint8Array, dpi: number): Promise<{ filePath: string } | null>;
  platform: string;
  setMenuState(state: MenuState): void;
  getThumbnail(id: string, key: string): Promise<string | null>;
  putThumbnail(id: string, key: string, dataURL: string): Promise<void>;
  listDrafts(): Promise<Draft[]>;
  writeDraft(draft: Draft): Promise<void>;
  deleteDraft(id: string): Promise<void>;
  checkpoint(draft: Draft): Promise<void>;
  openFile(id: string): Promise<OpenFileResult | null>;
  loadFile(id: string): Promise<{ data: Scene; filePath: string } | null>;
  saveFile(id: string, name: string, scene: Scene, saveAs: boolean): Promise<{ filePath: string; warning?: string } | null>;
  onCommand(listener: (command: string) => void): () => void;
  closeWindow(): void;
  cancelClose(): void;
}

declare global {
  interface Window { desktop: DesktopAPI; EXCALIDRAW_ASSET_PATH?: string }
}
