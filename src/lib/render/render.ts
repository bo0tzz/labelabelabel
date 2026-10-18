import QRCode from 'qrcode';
import { blit, createBitmap, fillRect, type Bitmap } from '#lib/bitmap.js';
import { fillTemplate } from '#lib/label/template.js';
import type {
	Align,
	BitmapBlock,
	Block,
	Label,
	LineBlock,
	QrBlock,
	TextBlock
} from '#lib/label/types.js';
import { dotsToMm, mmToDots, type MediaGeometry } from '#lib/media.js';
import { fillContours, PathFlattener, type Contour } from './fill.js';
import type { FontRegistry, LoadedFont, ShapedGlyph, ShapedRun } from './fonts.js';

export interface RenderOptions {
	fonts: FontRegistry;
	vars?: Record<string, string>;
}

/** Where a block ended up, in dots: x along the tape, y across it. */
export interface BlockLayout {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A problem with the label, tied to a block and field where possible. */
export interface RenderIssue {
	blockId?: string;
	field?: string;
	message: string;
}

export interface RenderedLabel {
	/** Height is the printable dots across the tape; width is in dots along it. */
	bitmap: Bitmap;
	dpi: { along: number; across: number };
	blocks: BlockLayout[];
	/** Length of the piece of tape the printer cuts. */
	tapeMm: number;
	issues: RenderIssue[];
}

interface Context extends RenderOptions {
	portrait: boolean;
	dpiAcross: number;
	dpiAlong: number;
	/** Dots along the tape per dot across it. */
	k: number;
	issues: RenderIssue[];
}

/** Space a block may fill, in dots. Blocks return a bitmap exactly `height` tall. */
interface Box {
	width?: number;
	height: number;
}

function offset(free: number, align: Align | undefined, fallback: Align = 'center') {
	switch (align ?? fallback) {
		case 'start':
			return 0;
		case 'end':
			return free;
		default:
			return Math.floor(free / 2);
	}
}

/** Em size in dots below which outline fonts stop being readable at 180 dpi. */
const MIN_LEGIBLE_EM = 7;

/** A group of glyphs placed in the text's own frame, in font units: u to the right, v down. */
interface Placement {
	u: number;
	baseline: number;
	glyphs: ShapedGlyph[];
}

interface TextLayout {
	placements: Placement[];
	width: number;
	height: number;
}

/** Lines one under the other, as text is normally written. */
function layoutLines(runs: ShapedRun[], font: LoadedFont, block: TextBlock): TextLayout {
	const lineUnits = (font.ascender - font.descender) * (block.lineHeight ?? 1);
	let above = font.ascender;
	let below = -font.descender;
	if (block.tight) {
		const first = font.inkExtents(runs[0], block.weight);
		const last = font.inkExtents(runs[runs.length - 1], block.weight);
		if (first && last) {
			above = first.top;
			below = -last.bottom;
		}
	}
	const width = Math.max(0, ...runs.map((r) => r.advance));
	return {
		width,
		height: above + below + (runs.length - 1) * lineUnits,
		placements: runs.map((run, i) => ({
			u: offset(width - run.advance, block.textAlign, 'start'),
			baseline: above + i * lineUnits,
			glyphs: run.glyphs
		}))
	};
}

/** Each glyph upright under the previous one; lines become columns from left to right. */
function layoutStacked(runs: ShapedRun[], font: LoadedFont, block: TextBlock): TextLayout {
	const step = (font.ascender - font.descender) * (block.lineHeight ?? 1);
	const advances = runs.map((run) => run.glyphs.map((g) => font.advance(g.gid, block.weight)));
	const column = Math.max(0, ...advances.flat());
	const gap = column * 0.25;
	const longest = Math.max(1, ...runs.map((r) => r.glyphs.length));
	const placements: Placement[] = [];
	runs.forEach((run, c) => {
		run.glyphs.forEach((g, j) => {
			placements.push({
				u: c * (column + gap) + (column - advances[c][j]) / 2,
				baseline: font.ascender + j * step,
				glyphs: [{ gid: g.gid, x: 0, y: 0 }]
			});
		});
	});
	return {
		width: runs.length * column + (runs.length - 1) * gap,
		height: (longest - 1) * step + font.ascender - font.descender,
		placements
	};
}

function renderText(block: TextBlock, box: Box, ctx: Context): Bitmap {
	const issue = (message: string, field?: string) =>
		ctx.issues.push({ blockId: block.id, field, message });
	const font = ctx.fonts.get(block.font);
	if (!font) {
		issue(`font ${block.font} is not available`, 'font');
		return createBitmap(0, box.height);
	}
	const lines = fillTemplate(block.text, ctx.vars).split('\n');
	const runs = lines.map((line) => font.shape(line, block.weight));
	const missing = [...new Set(runs.flatMap((r) => r.missing))];
	if (missing.length) issue(`${font.name} has no ${missing.join(' ')}`, 'text');

	const stacked = block.stack ?? ctx.portrait;
	const layout = stacked ? layoutStacked(runs, font, block) : layoutLines(runs, font, block);

	// Rotation is relative to the view; portrait views the tape turned a quarter.
	const rotation = ((block.rotate ?? 0) + (ctx.portrait ? 270 : 0)) % 360;
	const sideways = rotation === 90 || rotation === 270;
	// Room in the text's frame, in dots: to the right (u) and down (v).
	const boxWidth = box.width !== undefined ? box.width / ctx.k : undefined;
	const roomU = sideways ? box.height : boxWidth;
	const roomV = sideways ? boxWidth : box.height;

	let px: number;
	if (block.size) {
		px = (block.size / 72) * ctx.dpiAcross;
	} else {
		px = Infinity;
		if (roomV !== undefined && layout.height > 0) px = (roomV * font.upem) / layout.height;
		if (roomU !== undefined && layout.width > 0) {
			px = Math.min(px, (roomU * font.upem) / layout.width);
		}
		if (!Number.isFinite(px)) px = box.height;
	}
	px = font.pixelEm
		? Math.max(1, Math.floor(px / font.pixelEm)) * font.pixelEm
		: Math.max(1, block.size ? Math.round(px) : Math.floor(px));
	const scale = px / font.upem;

	const W = layout.width * scale;
	const T = layout.height * scale;
	if (!font.pixelEm && px < MIN_LEGIBLE_EM && block.text.trim()) {
		issue('text is too small to print legibly', block.size ? 'size' : 'text');
	}
	if (roomV !== undefined && T > roomV + 0.5) {
		issue(sideways ? 'text is wider than its box' : 'text is taller than its space', 'size');
	}
	if (roomU !== undefined && W > roomU + 0.5) {
		issue(
			sideways ? 'text is taller than its space' : 'text is wider than its box',
			block.size ? 'size' : sideways ? 'text' : 'width'
		);
	}

	// Place the text in the box, then map each glyph from the text's frame to the label's
	// (x along the tape in its dots, y across).
	const k = ctx.k;
	const s = scale;
	const oy = offset(box.height - (sideways ? W : T), block.align);
	const flattener = new PathFlattener({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
	for (const placement of layout.placements) {
		const originU = Math.round(placement.u * s);
		const baseline = Math.round(placement.baseline * s);
		for (const g of placement.glyphs) {
			const u = originU + g.x * s;
			const v = baseline - g.y * s;
			flattener.transform =
				rotation === 90
					? { a: 0, b: s, c: k * s, d: 0, e: k * (T - v), f: oy + u }
					: rotation === 180
						? { a: -k * s, b: 0, c: 0, d: s, e: k * (W - u), f: oy + T - v }
						: rotation === 270
							? { a: 0, b: -s, c: -k * s, d: 0, e: k * v, f: oy + W - u }
							: { a: k * s, b: 0, c: 0, d: -s, e: k * u, f: oy + v };
			font.draw(g.gid, block.weight, flattener);
		}
	}

	return contoursToBitmap(
		flattener.contours,
		Math.ceil((sideways ? T : W) * k),
		box.height,
		block.ink
	);
}

/** Rasterizes contours into a bitmap at least `width` wide, widened to fit overhanging ink. */
function contoursToBitmap(contours: Contour[], width: number, height: number, ink?: number) {
	let minX = 0;
	let maxX = width;
	for (const c of contours) {
		for (let i = 0; i < c.length; i += 2) {
			minX = Math.min(minX, c[i]);
			maxX = Math.max(maxX, c[i]);
		}
	}
	const left = Math.floor(minX);
	if (left < 0) {
		for (const c of contours) for (let i = 0; i < c.length; i += 2) c[i] -= left;
	}
	const bitmap = createBitmap(Math.ceil(maxX) - left, height);
	fillContours(bitmap, contours, { threshold: ink });
	return bitmap;
}

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
	const fit = Math.min(
		Math.floor(box.height / n),
		box.width !== undefined ? Math.floor(box.width / (ctx.k * (n + quiet * 2))) : Infinity
	);
	const module = block.module ?? fit;
	if (module < 1) {
		ctx.issues.push({ blockId: block.id, field: 'data', message: 'QR code does not fit' });
		return createBitmap(0, box.height);
	}
	if (block.module && block.module > fit) {
		ctx.issues.push({ blockId: block.id, field: 'module', message: 'QR code does not fit' });
	}
	const along = module * ctx.k;
	const bitmap = createBitmap((n + quiet * 2) * along, box.height);
	const top = offset(box.height - n * module, block.align);
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (modules.get(r, c)) fillRect(bitmap, (quiet + c) * along, top + r * module, along, module);
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

export function decodeBitmapData(data: string, w: number, h: number): Bitmap {
	const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
	const stride = Math.ceil(w / 8);
	const bitmap = createBitmap(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (bytes[y * stride + (x >> 3)] & (0x80 >> (x & 7))) bitmap.data[y * w + x] = 1;
		}
	}
	return bitmap;
}

export function encodeBitmapData(bitmap: Bitmap): string {
	const stride = Math.ceil(bitmap.width / 8);
	const bytes = new Uint8Array(stride * bitmap.height);
	for (let y = 0; y < bitmap.height; y++) {
		for (let x = 0; x < bitmap.width; x++) {
			if (bitmap.data[y * bitmap.width + x]) bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

/** Scales by nearest neighbour; when shrinking, a target pixel gets ink if any source pixel had it. */
export function resample(source: Bitmap, fx: number, fy: number): Bitmap {
	const w = Math.max(1, Math.round(source.width * fx));
	const h = Math.max(1, Math.round(source.height * fy));
	const out = createBitmap(w, h);
	for (let y = 0; y < h; y++) {
		const sy0 = Math.floor(y / fy);
		const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / fy));
		for (let x = 0; x < w; x++) {
			const sx0 = Math.floor(x / fx);
			const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / fx));
			let on = 0;
			for (let sy = sy0; sy < sy1 && !on; sy++) {
				for (let sx = sx0; sx < sx1 && !on; sx++) on = source.data[sy * source.width + sx];
			}
			out.data[y * w + x] = on;
		}
	}
	return out;
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

function renderBlock(block: Block, box: Box, ctx: Context): Bitmap {
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

interface Placed {
	id: string;
	bitmap: Bitmap;
	x: number;
	y: number;
}

function layoutRow(label: Label, height: number, ctx: Context) {
	const gap = mmToDots(label.gap ?? 2, ctx.dpiAlong);
	const placed: Placed[] = [];
	let x = 0;
	for (const block of label.blocks) {
		const width = block.width !== undefined ? mmToDots(block.width, ctx.dpiAlong) : undefined;
		const bitmap = renderBlock(block, { width, height }, ctx);
		if (bitmap.width > 0 && placed.some((p) => p.bitmap.width > 0)) x += gap;
		placed.push({ id: block.id, bitmap, x, y: 0 });
		x += bitmap.width;
	}
	return { placed, start: 0, end: x };
}

function layoutFree(label: Label, height: number, ctx: Context) {
	const placed: Placed[] = [];
	let start = Infinity;
	let end = 0;
	for (const block of label.blocks) {
		if (block.type === 'space') continue;
		// A drawing's box is its canvas, so resizing it crops or extends rather than stretches.
		const box =
			block.type === 'bitmap'
				? { height: Math.round((block.h * ctx.dpiAcross) / block.dpi[1]) }
				: {
						width: block.width !== undefined ? mmToDots(block.width, ctx.dpiAlong) : undefined,
						height: block.height !== undefined ? mmToDots(block.height, ctx.dpiAcross) : height
					};
		const bitmap = renderBlock(block, box, ctx);
		const x = mmToDots(block.x ?? 0, ctx.dpiAlong);
		const y = mmToDots(block.y ?? 0, ctx.dpiAcross);
		if (y < 0 || y + box.height > height) {
			ctx.issues.push({ blockId: block.id, message: 'sticks out of the printable area' });
		}
		placed.push({ id: block.id, bitmap, x, y });
		if (bitmap.width > 0) {
			start = Math.min(start, x);
			end = Math.max(end, x + bitmap.width);
		}
	}
	return { placed, start: Math.min(0, start), end };
}

export function renderLabel(
	label: Label,
	media: MediaGeometry,
	options: RenderOptions
): RenderedLabel {
	const dpiAcross = media.dpi;
	const dpiAlong = label.highRes && media.highRes ? dpiAcross * 2 : dpiAcross;
	const ctx: Context = {
		...options,
		portrait: label.orientation === 'portrait',
		dpiAcross,
		dpiAlong,
		k: dpiAlong / dpiAcross,
		issues: []
	};
	const height = media.dots;

	const free = label.layout === 'free';
	const { placed, start, end } = free
		? layoutFree(label, height, ctx)
		: layoutRow(label, height, ctx);
	const content = end - start;
	const padding = mmToDots(label.padding ?? 0, dpiAlong);
	const feed = media.feedMm * 2;
	const minData = mmToDots(media.minLengthMm, dpiAlong);

	let width = Math.max(minData, content + padding * 2);
	// Where content position 0 lands on the label.
	let origin = padding - start;
	if (label.length !== undefined) {
		if (label.length < media.minTapeMm) {
			ctx.issues.push({
				field: 'length',
				message: `the printer cannot cut labels shorter than ${media.minTapeMm} mm`
			});
		}
		const fixed = Math.max(minData, mmToDots(label.length - feed, dpiAlong));
		if (content + padding * 2 > fixed) {
			ctx.issues.push({ field: 'length', message: 'content is longer than the label' });
		}
		if (!free) origin += offset(fixed - content - padding * 2, label.justify);
		width = fixed;
	} else if (!free) {
		origin += Math.floor((width - content - padding * 2) / 2);
	}
	const maxData = mmToDots(media.maxLengthMm, dpiAlong);
	if (width > maxData) {
		ctx.issues.push({ field: 'length', message: `labels can be at most ${media.maxLengthMm} mm` });
		width = maxData;
	}

	const bitmap = createBitmap(width, height);
	const blocks: BlockLayout[] = [];
	for (const p of placed) {
		const x = origin + p.x;
		blocks.push({ id: p.id, x, y: p.y, width: p.bitmap.width, height: p.bitmap.height });
		if (p.bitmap.width) blit(bitmap, p.bitmap, x, p.y);
	}

	return {
		bitmap,
		dpi: { along: dpiAlong, across: dpiAcross },
		blocks,
		tapeMm: Math.max(media.minTapeMm, dotsToMm(width, dpiAlong) + feed),
		issues: ctx.issues
	};
}
