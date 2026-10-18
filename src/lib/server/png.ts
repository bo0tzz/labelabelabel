import { crc32, deflateSync } from 'node:zlib';
import type { Bitmap } from '#lib/bitmap.js';

function chunk(type: string, data: Uint8Array): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
	return Buffer.concat([head, data, crc]);
}

/** Encodes a bitmap as an 8-bit grayscale PNG, ink black on white, scaled per axis. */
export function bitmapToPng(bitmap: Bitmap, scaleX = 1, scaleY = scaleX): Buffer {
	const width = bitmap.width * scaleX;
	const height = bitmap.height * scaleY;
	const raw = Buffer.alloc((width + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width + 1);
		const sy = Math.floor(y / scaleY);
		for (let x = 0; x < width; x++) {
			raw[row + 1 + x] = bitmap.data[sy * bitmap.width + Math.floor(x / scaleX)] ? 0 : 255;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array())
	]);
}
