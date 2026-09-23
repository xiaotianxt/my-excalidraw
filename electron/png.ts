const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// PNG pHYs uses pixels per metre. Copy every other chunk byte-for-byte, notably
// Excalidraw's embedded scene metadata; changing DPI never resamples the image.
export function withPngDpi(input: Uint8Array, dpi: number): Buffer {
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 2400) throw new Error('无效的 PNG DPI。');
  const png = Buffer.from(input);
  if (!png.subarray(0, 8).equals(signature)) throw new Error('无效的 PNG 数据。');
  const physical = Buffer.alloc(21);
  physical.writeUInt32BE(9, 0);
  physical.write('pHYs', 4, 'ascii');
  physical.writeUInt32BE(Math.round(dpi / 0.0254), 8);
  physical.writeUInt32BE(Math.round(dpi / 0.0254), 12);
  physical[16] = 1;
  physical.writeUInt32BE(crc32(physical.subarray(4, 17)), 17);
  const chunks = [signature];
  let offset = 8;
  let header = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > png.length) throw new Error('PNG 数据不完整。');
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (!header && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 缺少有效 IHDR。');
    if (type !== 'pHYs') chunks.push(png.subarray(offset, end));
    if (!header) { chunks.push(physical); header = true; }
    if (type === 'IEND') {
      if (length !== 0 || end !== png.length) throw new Error('PNG 结束标记无效。');
      return Buffer.concat(chunks);
    }
    offset = end;
  }
  throw new Error('PNG 缺少结束标记。');
}
