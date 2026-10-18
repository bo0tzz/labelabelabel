import { blit, createBitmap, crop, type Bitmap } from '#lib/bitmap.js';
import { fillTemplate } from '#lib/label/template.js';
import type { TextBlock } from '#lib/label/types.js';
import type { LoadedFont, ShapedGlyph, ShapedRun, Variant } from './fonts.js';
import { offset, type Box, type Context } from './context.js';
import { rasterize, rasterReady } from './raster.js';

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

export function renderText(block: TextBlock, box: Box, ctx: Context): Bitmap {
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
