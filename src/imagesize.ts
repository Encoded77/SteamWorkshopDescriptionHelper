/**
 * Intrinsic dimensions from the file header, so annotation geometry resolves in
 * Node and out-of-bounds coordinates can be reported against the real size.
 */

export interface Size {
  width: number;
  height: number;
}

export function imageSize(data: Buffer, src: string): Size {
  if (isPng(data)) return pngSize(data, src);
  if (isJpeg(data)) return jpegSize(data, src);

  throw new Error(
    `Cannot read dimensions of ${src}.\n` +
      `  Annotated images must be PNG or JPEG — the highlight coordinates are\n` +
      `  resolved against the image's real pixel size.`,
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(d: Buffer): boolean {
  return d.length >= 24 && d.subarray(0, 8).equals(PNG_MAGIC);
}

function pngSize(d: Buffer, src: string): Size {
  // Signature (8) + chunk length (4) + "IHDR" (4), then width and height.
  if (d.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${src}: PNG is malformed (no IHDR chunk where expected).`);
  }
  return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
}

function isJpeg(d: Buffer): boolean {
  return d.length >= 4 && d[0] === 0xff && d[1] === 0xd8;
}

function jpegSize(d: Buffer, src: string): Size {
  let offset = 2;

  while (offset < d.length - 9) {
    if (d[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = d[offset + 1]!;

    // SOF0-SOF15 carry the frame dimensions. C4 (Huffman tables), C8 (JPEG
    // extensions), and CC (arithmetic coding conditioning) share the range but
    // are not frame headers.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      return { height: d.readUInt16BE(offset + 5), width: d.readUInt16BE(offset + 7) };
    }

    // Standalone markers carry no length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    offset += 2 + d.readUInt16BE(offset + 2);
  }

  throw new Error(`${src}: JPEG is malformed (no frame header found).`);
}
