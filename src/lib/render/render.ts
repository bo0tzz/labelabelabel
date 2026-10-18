import QRCode from 'qrcode';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras';
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
import type { FontRegistry, LoadedFont, ShapedGlyph, ShapedRun, Variant } from './fonts.js';
import { rasterize, rasterReady } from './raster.js';

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
	/** Not a problem, just something worth showing, like how a QR code was sized. */
	info?: boolean;
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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const EMOJI_PRESENTATION = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F/u;

/**
 * Shapes a line, taking characters the font lacks (typically emoji) from the fallback font.
 * Fallback glyph positions are converted to the main font's units.
 */
function shapeLine(
	text: string,
	font: LoadedFont,
	fallback: LoadedFont | undefined,
	variant: Variant
): ShapedRun {
	if (!fallback || fallback === font) return font.shape(text, variant);
	// Whole grapheme clusters go to one font, so emoji sequences stay together. Emoji go to the
	// fallback when it has them, even if the main font has a plain text version.
	const segments: { text: string; font: LoadedFont }[] = [];
	for (const { segment } of graphemes.segment(text)) {
		const base = segment.codePointAt(0)!;
		const wantsFallback = !font.hasChar(base) || EMOJI_PRESENTATION.test(segment);
		const useFont = wantsFallback && fallback.hasChar(base) ? fallback : font;
		const last = segments.at(-1);
		if (last?.font === useFont) last.text += segment;
		else segments.push({ text: segment, font: useFont });
	}
	if (segments.every((seg) => seg.font === font)) return font.shape(text, variant);

	const glyphs: ShapedGlyph[] = [];
	const missing = new Set<string>();
	let advance = 0;
	for (const segment of segments) {
		const run = segment.font.shape(segment.text, variant);
		const fromFallback = segment.font !== font;
		const ratio = fromFallback ? font.upem / segment.font.upem : 1;
		for (const g of run.glyphs) {
			glyphs.push({
				gid: g.gid,
				x: advance + g.x * ratio,
				y: g.y * ratio,
				...(fromFallback ? { font: segment.font, ratio } : {})
			});
		}
		for (const m of run.missing) if (!font.hasChar(m.codePointAt(0)!)) missing.add(m);
		advance += run.advance * ratio;
	}
	return { glyphs, advance, missing: [...missing] };
}

/** Ink box of a glyph in the main font's units, y up. */
function glyphExtents(g: ShapedGlyph, font: LoadedFont, variant: Variant) {
	const e = (g.font ?? font).extents(g.gid, variant);
	if (!e) return undefined;
	const r = g.ratio ?? 1;
	return {
		xBearing: e.xBearing * r,
		yBearing: e.yBearing * r,
		width: e.width * r,
		height: e.height * r
	};
}

/** Highest and lowest ink of a shaped run relative to the baseline, in font units. */
function runInk(run: ShapedRun, font: LoadedFont, variant: Variant) {
	let top = -Infinity;
	let bottom = Infinity;
	for (const g of run.glyphs) {
		const e = glyphExtents(g, font, variant);
		if (!e || e.height === 0) continue;
		top = Math.max(top, g.y + e.yBearing);
		bottom = Math.min(bottom, g.y + e.yBearing + e.height);
	}
	return top > bottom ? { top, bottom } : undefined;
}

/** Lines one under the other, as text is normally written. */
function layoutLines(runs: ShapedRun[], font: LoadedFont, block: TextBlock): TextLayout {
	const lineUnits = (font.ascender - font.descender) * (block.lineHeight ?? 1);
	let above = font.ascender;
	let below = -font.descender;
	if (block.tight) {
		const first = runInk(runs[0], font, variantOf(block));
		const last = runInk(runs[runs.length - 1], font, variantOf(block));
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

/**
 * Each glyph upright under the previous one, spaced by their ink so tall and short letters
 * leave the same gap. Lines become columns from left to right.
 */
function layoutStacked(runs: ShapedRun[], font: LoadedFont, block: TextBlock): TextLayout {
	const spacing = block.lineHeight ?? 1;
	const gap = font.upem * 0.12 * spacing;
	const space = font.upem * 0.4 * spacing;
	const extents = runs.map((run) => run.glyphs.map((g) => glyphExtents(g, font, variantOf(block))));
	const column = Math.max(0, ...extents.flat().map((e) => e?.width ?? 0));
	const columnGap = column * 0.3;
	const placements: Placement[] = [];
	let height = 0;
	runs.forEach((run, c) => {
		let cursor = 0;
		run.glyphs.forEach((g, j) => {
			const e = extents[c][j];
			if (!e || e.height === 0) {
				cursor += space;
				return;
			}
			placements.push({
				u: c * (column + columnGap) + (column - e.width) / 2 - e.xBearing,
				baseline: cursor + e.yBearing,
				glyphs: [{ ...g, x: 0, y: 0 }]
			});
			cursor += -e.height + gap;
			height = Math.max(height, cursor - gap);
		});
	});
	return {
		width: runs.length * column + Math.max(0, runs.length - 1) * columnGap,
		height,
		placements
	};
}

function variantOf(block: TextBlock): Variant {
	return { weight: block.weight, fill: block.filled };
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
	const runs = lines.map((line) => shapeLine(line, font, ctx.fonts.fallback, variantOf(block)));
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
	const variant = variantOf(block);
	const paths: string[] = [];
	for (const placement of layout.placements) {
		const originU = Math.round(placement.u * s);
		const baseline = Math.round(placement.baseline * s);
		for (const g of placement.glyphs) {
			const d = (g.font ?? font).path(g.gid, variant);
			if (!d) continue;
			const u = originU + g.x * s;
			const v = baseline - g.y * s;
			// Outline units per dot differ for glyphs from a fallback font.
			const gs = s * (g.ratio ?? 1);
			const m =
				rotation === 90
					? [0, gs, k * gs, 0, k * (T - v), oy + u]
					: rotation === 180
						? [-k * gs, 0, 0, gs, k * (W - u), oy + T - v]
						: rotation === 270
							? [0, -gs, -k * gs, 0, k * v, oy + W - u]
							: [k * gs, 0, 0, -gs, k * u, oy + v];
			paths.push(`<path transform="matrix(${m.join(' ')})" d="${d}"/>`);
		}
	}
	if (!paths.length || !rasterReady()) return createBitmap(0, box.height);

	// Render with room on both sides for ink that overhangs the advance, then trim to it.
	const width = Math.ceil((sideways ? T : W) * k);
	const margin = Math.ceil(px * k);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width + margin * 2}" height="${box.height}"` +
		` viewBox="${-margin} 0 ${width + margin * 2} ${box.height}">${paths.join('')}</svg>`;
	const image = rasterize(svg, block.ink);
	let left = margin;
	let right = margin + width;
	for (let x = 0; x < image.width; x++) {
		for (let y = 0; y < image.height; y++) {
			if (!image.data[y * image.width + x]) continue;
			left = Math.min(left, x);
			right = Math.max(right, x + 1);
			break;
		}
	}
	const bitmap = createBitmap(right - left, box.height);
	blit(bitmap, crop(image, left, right), 0, 0);
	return bitmap;
}

function crop(image: Bitmap, left: number, right: number): Bitmap {
	const out = createBitmap(right - left, image.height);
	for (let y = 0; y < image.height; y++) {
		out.data.set(
			image.data.subarray(y * image.width + left, y * image.width + right),
			y * out.width
		);
	}
	return out;
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

export function decodeBitmapData(data: string, w: number, h: number): Bitmap {
	const bytes = base64ToUint8Array(data);
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
	return uint8ArrayToBase64(bytes);
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
