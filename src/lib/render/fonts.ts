import * as hb from 'harfbuzzjs';
import type { PathFlattener } from './fill.js';
import { readLigatures } from './gsub.js';

const drawFuncs = new hb.DrawFuncs();
drawFuncs.setMoveToFunc((x, y, p) => (p as PathFlattener).moveTo(x, y));
drawFuncs.setLineToFunc((x, y, p) => (p as PathFlattener).lineTo(x, y));
drawFuncs.setQuadraticToFunc((cx, cy, x, y, p) => (p as PathFlattener).quadTo(cx, cy, x, y));
drawFuncs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y, p) =>
	(p as PathFlattener).cubicTo(c1x, c1y, c2x, c2y, x, y)
);
drawFuncs.setClosePathFunc((p) => (p as PathFlattener).close());

export interface ShapedGlyph {
	gid: number;
	/** Pen position in font units. */
	x: number;
	y: number;
}

export interface ShapedRun {
	glyphs: ShapedGlyph[];
	advance: number;
	/** Characters the font has no glyph for. */
	missing: string[];
}

export class LoadedFont {
	readonly face: hb.Face;
	readonly upem: number;
	readonly ascender: number;
	readonly descender: number;
	readonly lineGap: number;
	/** Set for fonts drawn on a pixel grid: the em size in pixels at 1×. */
	readonly pixelEm: number | undefined;
	readonly weightAxis: { min: number; max: number; default: number } | undefined;
	#fonts = new Map<number, hb.Font>();

	constructor(
		readonly id: string,
		data: ArrayBuffer | Uint8Array
	) {
		this.face = new hb.Face(new hb.Blob(data));
		this.upem = this.face.upem;
		if (!this.upem || !this.face.collectUnicodes().length) throw new Error('not a usable font');
		const axes = this.face.getAxisInfos();
		this.weightAxis = axes.wght;
		const extents = this.font().hExtents();
		this.ascender = extents.ascender;
		this.descender = extents.descender;
		this.lineGap = extents.lineGap;
		this.pixelEm = this.#detectPixelGrid();
	}

	get name(): string {
		return this.face.getName(4, 'en') || this.face.getName(1, 'en') || this.id;
	}

	font(weight?: number): hb.Font {
		const key = this.weightAxis && weight !== undefined ? weight : 0;
		let font = this.#fonts.get(key);
		if (!font) {
			font = new hb.Font(this.face);
			if (key) font.setVariations([new hb.Variation('wght', key)]);
			this.#fonts.set(key, font);
		}
		return font;
	}

	shape(text: string, weight?: number): ShapedRun {
		const font = this.font(weight);
		const buffer = new hb.Buffer();
		buffer.addText(text);
		buffer.guessSegmentProperties();
		hb.shape(font, buffer);
		const infos = buffer.getGlyphInfos();
		const positions = buffer.getGlyphPositions();
		const glyphs: ShapedGlyph[] = [];
		const missing = new Set<string>();
		const units = [...text];
		let x = 0;
		let y = 0;
		infos.forEach((info, i) => {
			const p = positions[i];
			glyphs.push({ gid: info.codepoint, x: x + p.xOffset, y: y + p.yOffset });
			if (info.codepoint === 0) {
				const char = text.slice(info.cluster).match(/^./su)?.[0] ?? units[0];
				if (char.trim()) missing.add(char);
			}
			x += p.xAdvance;
			y += p.yAdvance;
		});
		return { glyphs, advance: x, missing: [...missing] };
	}

	draw(gid: number, weight: number | undefined, flattener: PathFlattener) {
		this.font(weight).drawGlyph(gid, drawFuncs, flattener);
		flattener.close();
	}

	/**
	 * A font is treated as a pixel font when nearly all outline points and advances of sample
	 * glyphs fall on a grid that divides the em. Some pixel fonts have the odd stray point.
	 */
	#detectPixelGrid(): number | undefined {
		const font = this.font();
		const values: number[] = [];
		for (const ch of 'HOamg0x') {
			const gid = font.glyph(ch.codePointAt(0)!);
			if (!gid) continue;
			for (const cmd of font.glyphToJson(gid)) values.push(...cmd.values);
			values.push(font.glyphHAdvance(gid));
		}
		if (values.length < 20) return undefined;
		for (let em = 5; em <= 64; em++) {
			const grid = this.upem / em;
			if (!Number.isInteger(grid)) continue;
			const onGrid = values.filter((v) => Number.isInteger(v) && v % grid === 0).length;
			if (onGrid / values.length >= 0.9) return em;
		}
		return undefined;
	}

	/** Characters in the private use area, where symbol and icon fonts keep their glyphs. */
	symbols(): string[] {
		return [...this.face.collectUnicodes()]
			.filter((u) => (u >= 0xe000 && u <= 0xf8fe) || (u >= 0xf0000 && u <= 0x10fffd))
			.map((u) => String.fromCodePoint(u));
	}

	/**
	 * Text that the font's ligatures turn into its symbols, like `TX` in Schraubenkiste. Read
	 * from the GSUB ligature table; the shortest sequence that shapes to the symbol wins.
	 */
	symbolCodes(): Map<string, string> {
		const symbols = this.symbols();
		const codes = new Map<string, string>();
		const gsub = this.face.referenceTable('GSUB');
		if (!symbols.length || !gsub) return codes;

		const font = this.font();
		const symbolByGlyph = new Map<number, string>();
		for (const symbol of symbols) {
			const gid = font.glyph(symbol.codePointAt(0)!);
			if (gid) symbolByGlyph.set(gid, symbol);
		}
		const charByGlyph = new Map<number, string>();
		for (const u of this.face.collectUnicodes()) {
			const gid = font.glyph(u);
			if (gid && !charByGlyph.has(gid)) charByGlyph.set(gid, String.fromCodePoint(u));
		}

		const ligatures = readLigatures(gsub).sort((a, b) => a.components.length - b.components.length);
		for (const { glyph, components } of ligatures) {
			const symbol = symbolByGlyph.get(glyph);
			if (!symbol || codes.has(symbol)) continue;
			const chars = components.map((g) => charByGlyph.get(g));
			if (chars.some((c) => c === undefined)) continue;
			const code = chars.join('');
			const shaped = this.shape(code).glyphs;
			if (shaped.length === 1 && shaped[0].gid === glyph) codes.set(symbol, code);
		}
		return codes;
	}

	/** Highest and lowest ink of a shaped run, in font units relative to the baseline. */
	inkExtents(run: ShapedRun, weight?: number): { top: number; bottom: number } | undefined {
		const font = this.font(weight);
		let top = -Infinity;
		let bottom = Infinity;
		for (const g of run.glyphs) {
			const e = font.glyphExtents(g.gid);
			if (!e || e.height === 0) continue;
			top = Math.max(top, g.y + e.yBearing);
			bottom = Math.min(bottom, g.y + e.yBearing + e.height);
		}
		return top > bottom ? { top, bottom } : undefined;
	}
}

export class FontRegistry {
	#fonts = new Map<string, LoadedFont>();

	add(id: string, data: ArrayBuffer | Uint8Array): LoadedFont {
		const font = new LoadedFont(id, data);
		this.#fonts.set(id, font);
		return font;
	}

	get(id: string): LoadedFont | undefined {
		return this.#fonts.get(id);
	}

	has(id: string) {
		return this.#fonts.has(id);
	}
}
