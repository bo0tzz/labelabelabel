import QRCode from 'qrcode';
import { blit, createBitmap, fillRect, resample, type Bitmap } from '#lib/bitmap.js';
import { decodeBitmapData } from '#lib/label/drawing.js';
import { fillTemplate } from '#lib/label/template.js';
import type { BitmapBlock, Block, LineBlock, QrBlock } from '#lib/label/types.js';
import { offset, type Box, type Context } from './context.js';
import { renderText } from './text.js';

function renderQr(block: QrBlock, box: Box, ctx: Context): Bitmap {
	const data = fillTemplate(block.data, ctx.vars);
	if (!data) return createBitmap(0, box.height);
	let modules;
	try {
		modules = QRCode.create(data, { errorCorrectionLevel: block.ecc ?? 'M' }).modules;
	} catch {
		ctx.issues.push({ blockId: block.id, field: 'data', message: 'too much data for a QR code' });
		return createBitmap(0, box.height);
	}
	const n = modules.size;
	const quiet = block.quiet ?? 2;
	// Largest size across the tape the box allows, in dots; along it the quiet zone counts too.
	const room = Math.min(
		box.height,
		box.width !== undefined ? (box.width / ctx.k) * (n / (n + quiet * 2)) : Infinity
	);
	const fit = Math.floor(room / n);
	const note = (message: string) =>
		ctx.issues.push({ blockId: block.id, field: 'module', message, info: true });

	let size: number;
	if (block.stretch) {
		size = Math.floor(room);
		note(`${n} modules over ${size} dots, ${(size / n).toFixed(1)} dots each`);
	} else {
		const module = block.module ?? fit;
		if (block.module && block.module > fit) {
			ctx.issues.push({ blockId: block.id, field: 'module', message: 'QR code does not fit' });
		}
		size = module * n;
		note(
			`${n} modules, ${module} ${module === 1 ? 'dot' : 'dots'} each: ${size} of ${box.height} dots`
		);
	}
	if (size < n) {
		ctx.issues.push({ blockId: block.id, field: 'data', message: 'QR code does not fit' });
		return createBitmap(0, box.height);
	}

	// Module edges in dots; with a whole number of dots per module they are evenly spaced.
	const across = (i: number) => Math.round((i * size) / n);
	const along = (i: number) => Math.round((i * size * ctx.k) / n);
	const bitmap = createBitmap(along(n + quiet * 2), box.height);
	const top = offset(box.height - size, block.align);
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (!modules.get(r, c)) continue;
			const x = along(quiet + c);
			const y = across(r);
			fillRect(bitmap, x, top + y, along(quiet + c + 1) - x, across(r + 1) - y);
		}
	}
	return bitmap;
}

function renderLine(block: LineBlock, box: Box, ctx: Context): Bitmap {
	const thickness = Math.max(1, Math.round(block.thickness));
	if (block.direction === 'along') {
		const width = box.width ?? 0;
		if (!width) {
			ctx.issues.push({ blockId: block.id, field: 'width', message: 'needs a width' });
		}
		const bitmap = createBitmap(width, box.height);
		fillRect(bitmap, 0, offset(box.height - thickness, block.align), width, thickness);
		return bitmap;
	}
	const length = Math.round(box.height * Math.min(1, Math.max(0, block.extent ?? 1)));
	const bitmap = createBitmap(thickness * ctx.k, box.height);
	fillRect(bitmap, 0, offset(box.height - length, block.align), thickness * ctx.k, length);
	return bitmap;
}

function renderBitmap(block: BitmapBlock, box: Box, ctx: Context): Bitmap {
	let image = decodeBitmapData(block.data, block.w, block.h);
	const fx = ctx.dpiAlong / block.dpi[0];
	const fy = ctx.dpiAcross / block.dpi[1];
	if (fx !== 1 || fy !== 1) {
		if (fx < 1 || fy < 1) {
			ctx.issues.push({ blockId: block.id, message: 'drawing loses detail at this resolution' });
		} else if (!Number.isInteger(fx) || !Number.isInteger(fy)) {
			ctx.issues.push({ blockId: block.id, message: 'drawing does not scale evenly' });
		}
		image = resample(image, fx, fy);
	}
	if (image.height > box.height) {
		ctx.issues.push({ blockId: block.id, message: 'drawing is taller than its space' });
	}
	const bitmap = createBitmap(image.width, box.height);
	blit(bitmap, image, 0, offset(box.height - image.height, block.align));
	return bitmap;
}

export function renderBlock(block: Block, box: Box, ctx: Context): Bitmap {
	let bitmap: Bitmap;
	switch (block.type) {
		case 'text':
			bitmap = renderText(block, box, ctx);
			break;
		case 'qr':
			bitmap = renderQr(block, box, ctx);
			break;
		case 'line':
			bitmap = renderLine(block, box, ctx);
			break;
		case 'bitmap':
			bitmap = renderBitmap(block, box, ctx);
			break;
		case 'space':
			bitmap = createBitmap(0, box.height);
			break;
	}
	if (box.width === undefined || bitmap.width === box.width) return bitmap;
	if (bitmap.width > box.width && block.type !== 'text') {
		ctx.issues.push({
			blockId: block.id,
			field: 'width',
			message: 'content is wider than its box'
		});
	}
	const fixed = createBitmap(box.width, box.height);
	const hAlign = block.type === 'text' ? block.textAlign : 'center';
	blit(fixed, bitmap, offset(box.width - bitmap.width, hAlign, 'start'), 0);
	return fixed;
}
