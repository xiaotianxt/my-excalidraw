import { memo, useState } from 'react';
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { sceneData, type OpenDocument, type Scene } from '../document';

function Editor({ document, onChange, onAPI, onClear, onExport }: { document: OpenDocument; onChange: (data: Scene, id: string) => void; onAPI: (api: ExcalidrawImperativeAPI) => void; onClear: () => void; onExport: () => void }) {
  const [initial] = useState(() => document.data);
  return <Excalidraw initialData={initial} excalidrawAPI={onAPI} langCode="zh-CN"
    onChange={(elements, appState, files) => onChange(sceneData(elements, appState, files), document.id)}
    UIOptions={{ canvasActions: { clearCanvas: false, loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }}>
    <MainMenu>
      <MainMenu.Item onSelect={onClear}>清空当前草稿…</MainMenu.Item>
      <MainMenu.Item onSelect={onExport}>导出图像…</MainMenu.Item>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  </Excalidraw>;
}

// A document's initial scene is consumed only on mount. Autosave/status changes
// must not re-render the drawing engine; explicit clear/restore uses its API.
export default memo(Editor, (previous, next) => previous.document.id === next.document.id &&
  previous.onChange === next.onChange && previous.onAPI === next.onAPI && previous.onClear === next.onClear && previous.onExport === next.onExport);
