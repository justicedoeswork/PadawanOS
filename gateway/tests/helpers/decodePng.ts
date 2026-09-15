import zlib from 'node:zlib';

/**
 * Minimal PNG pixel decoder -- no dependency exists in this repo for
 * reading actual pixel data (only IHDR-header dimension parsing existed
 * before), and pulling one in for a handful of pixel-sampling tests isn't
 * worth it. Supports exactly what this project's own asset pipeline
 * produces: 8-bit depth, non-interlaced, color type 2 (RGB) or 6 (RGBA).
 */
export interface DecodedPng {
  width: number;
  height: number;
  channels: 3 | 4;
  // Row-major, top-to-bottom, `channels` bytes per pixel.
  data: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): DecodedPng {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw new Error('not a PNG file');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported color type ${colorType}`);

  const channels: 3 | 4 = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));

  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rawOffset = 0;
  let prevRowStart = -1;

  for (let y = 0; y < height; y++) {
    const filterType = raw.readUInt8(rawOffset);
    rawOffset += 1;
    const rowStart = y * stride;

    for (let i = 0; i < stride; i++) {
      const x = raw.readUInt8(rawOffset + i);
      const a = i >= channels ? out.readUInt8(rowStart + i - channels) : 0;
      const b = prevRowStart >= 0 ? out.readUInt8(prevRowStart + i) : 0;
      const c = prevRowStart >= 0 && i >= channels ? out.readUInt8(prevRowStart + i - channels) : 0;

      let value: number;
      switch (filterType) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + Math.floor((a + b) / 2);
          break;
        case 4:
          value = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`unsupported filter type ${filterType}`);
      }
      out[rowStart + i] = value & 0xff;
    }

    rawOffset += stride;
    prevRowStart = rowStart;
  }

  return { width, height, channels, data: out };
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getPixel(png: DecodedPng, x: number, y: number): Rgba {
  const idx = (y * png.width + x) * png.channels;
  return {
    r: png.data.readUInt8(idx),
    g: png.data.readUInt8(idx + 1),
    b: png.data.readUInt8(idx + 2),
    a: png.channels === 4 ? png.data.readUInt8(idx + 3) : 255,
  };
}
