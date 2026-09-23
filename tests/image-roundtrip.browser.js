(async () => {
  const tools = await import(globalThis.imageServiceURL);
  const plainSvg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#dedaff"/><text x="20" y="65" font-size="20">Image fixture</text></svg>');
  const plain = await tools.importImage(plainSvg, 'image/svg+xml');
  if (plain.embedded || plain.data.elements.length !== 1 || plain.data.elements[0].type !== 'image') throw Error('Plain SVG import failed');
  const base = { ...plain.data.elements[0] };
  for (const key of ['fileId', 'status', 'scale', 'crop']) delete base[key];
  const box = { ...base, type: 'rectangle', id: 'roundtrip-box', x: 0, y: 0, width: 320, height: 180, index: 'a0', strokeColor: '#5b50dc', backgroundColor: '#dedaff', fillStyle: 'solid' };
  const text = { ...base, type: 'text', id: 'roundtrip-text', x: 20, y: 20, width: 180, height: 50, index: 'a1', fontSize: 20, fontFamily: 5, text: 'Editable text\nTwo lines', originalText: 'Editable text\nTwo lines', textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: false };
  const image = { ...plain.data.elements[0], x: 400, index: 'a2' };
  const scene = { ...plain.data, elements: [box, text, image] };
  const settings = { scale: 3, dpi: 600, embedScene: true, background: true };
  await window.desktop.saveExportSettings(settings);
  const summary = [];
  let svgBytes;
  for (const format of ['png', 'svg']) {
    const bytes = await tools.renderImage(scene, format, settings);
    const restored = await tools.importImage(bytes, format === 'png' ? 'image/png' : 'image/svg+xml');
    if (!restored.embedded || restored.data.elements.length !== 3 || restored.data.elements.find(e => e.id === text.id)?.text !== text.text || JSON.stringify(restored.data.files) !== JSON.stringify(scene.files)) throw Error(`${format} roundtrip failed`);
    if (!await window.desktop.exportImage('roundtrip', format, bytes, settings.dpi)) throw Error('Test picker cancelled');
    if (format === 'svg') svgBytes = bytes;
    summary.push({ format, elements: restored.data.elements.length, images: Object.keys(restored.data.files).length });
  }
  const flat = await tools.renderImage(scene, 'png', { ...settings, embedScene: false });
  const flatResult = await tools.importImage(flat, 'image/png');
  if (flatResult.embedded || flatResult.data.elements[0].type !== 'image') throw Error('Flat PNG should import as an image');
  const opened = await window.desktop.openFile('dpi-roundtrip');
  const restored = await tools.importImage(opened.bytes, opened.mimeType);
  if (!restored.embedded || restored.data.elements.length !== 3) throw Error('Native DPI write lost embedded scene');
  const svg = new TextDecoder().decode(svgBytes);
  const damaged = svg.replace(/(<!-- payload-start -->)[\s\S]*?(<!-- payload-end -->)/, '$1%%%invalid%%%$2');
  if (damaged === svg) throw Error('SVG payload marker missing');
  let rejected = false;
  try { await tools.importImage(new TextEncoder().encode(damaged), 'image/svg+xml'); } catch { rejected = true; }
  if (!rejected) throw Error('Corrupt scene was silently flattened');
  return { exports: summary, flatImages: true, dpiRoundtrip: true, corruptSceneRejected: true };
})()
