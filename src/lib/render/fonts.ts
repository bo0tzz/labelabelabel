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

/** Settings of a variable font's axes. */
export interface Variant {
	weight?: number;
	fill?: boolean;
}

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
	/** Variable icon fonts like Material Symbols can switch between outlined and filled. */
	readonly hasFill: boolean;
	#fonts = new Map<string, hb.Font>();

	constructor(
		readonly id: string,
		data: ArrayBuffer | Uint8Array
	) {
		this.face = new hb.Face(new hb.Blob(data));
		this.upem = this.face.upem;
		if (!this.upem || !this.face.collectUnicodes().length) throw new Error('not a usable font');
		const axes = this.face.getAxisInfos();
		this.weightAxis = axes.wght;
		this.hasFill = !!axes.FILL;
		const extents = this.font().hExtents();
		this.ascender = extents.ascender;
		this.descender = extents.descender;
		this.lineGap = extents.lineGap;
		this.pixelEm = this.#detectPixelGrid();
	}

	get name(): string {
		return this.face.getName(4, 'en') || this.face.getName(1, 'en') || this.id;
	}

	font(variant: Variant = {}): hb.Font {
		const weight = this.weightAxis ? variant.weight : undefined;
		const fill = this.hasFill && variant.fill ? 1 : 0;
		const key = `${weight ?? ''}:${fill}`;
		let font = this.#fonts.get(key);
		if (!font) {
			font = new hb.Font(this.face);
			const variations = [];
			if (weight !== undefined) variations.push(new hb.Variation('wght', weight));
			if (fill) variations.push(new hb.Variation('FILL', 1));
			if (variations.length) font.setVariations(variations);
			this.#fonts.set(key, font);
		}
		return font;
	}

	shape(text: string, variant?: Variant): ShapedRun {
		const font = this.font(variant);
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

	/** Ink box of a glyph in font units, y up; undefined for glyphs without ink. */
	extents(gid: number, variant?: Variant) {
		return this.font(variant).glyphExtents(gid);
	}

	draw(gid: number, variant: Variant | undefined, flattener: PathFlattener) {
		this.font(variant).drawGlyph(gid, drawFuncs, flattener);
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

	/**
	 * Characters in the private use area, where symbol and icon fonts keep their glyphs. When
	 * several map to one glyph, the lowest is kept.
	 */
	symbols(): string[] {
		const font = this.font();
		const seen = new Set<number>();
		const symbols: string[] = [];
		for (const u of [...this.face.collectUnicodes()].sort((a, b) => a - b)) {
			if (!((u >= 0xe000 && u <= 0xf8fe) || (u >= 0xf0000 && u <= 0x10fffd))) continue;
			const gid = font.glyph(u);
			if (!gid || seen.has(gid)) continue;
			seen.add(gid);
			symbols.push(String.fromCodePoint(u));
		}
		return symbols;
	}

	/**
	 * Text that the font's ligatures turn into its symbols, like `TX` in Schraubenkiste or
	 * `home` in Material Symbols. Read from the GSUB ligature table and checked by shaping;
	 * each symbol's names are sorted shortest first.
	 */
	symbolNames(): Map<string, string[]> {
		const symbols = this.symbols();
		const names = new Map<string, string[]>();
		// The table is a view into wasm memory, which moves when it grows.
		const gsub = this.face.referenceTable('GSUB')?.slice();
		if (!symbols.length || !gsub) return names;

		const font = this.font();
		const symbolByGlyph = new Map<number, string>();
		for (const symbol of symbols) {
			const gid = font.glyph(symbol.codePointAt(0)!);
			if (gid) symbolByGlyph.set(gid, symbol);
		}
		// Icon fonts often map both cases to one glyph; names read better in lowercase.
		const charByGlyph = new Map<number, string>();
		for (const u of this.face.collectUnicodes()) {
			const gid = font.glyph(u);
			const char = String.fromCodePoint(u);
			if (gid && (!charByGlyph.has(gid) || /[a-z]/.test(char))) charByGlyph.set(gid, char);
		}

		for (const { glyph, components } of readLigatures(gsub)) {
			const symbol = symbolByGlyph.get(glyph);
			if (!symbol) continue;
			const chars = components.map((g) => charByGlyph.get(g));
			if (chars.some((c) => c === undefined)) continue;
			const name = chars.join('');
			const shaped = this.shape(name).glyphs;
			if (shaped.length !== 1 || shaped[0].gid !== glyph) continue;
			const list = names.get(symbol) ?? [];
			if (!list.includes(name)) list.push(name);
			names.set(symbol, list);
		}
		for (const list of names.values()) list.sort((a, b) => a.length - b.length);
		return names;
	}

	/** Highest and lowest ink of a shaped run, in font units relative to the baseline. */
	inkExtents(run: ShapedRun, variant?: Variant): { top: number; bottom: number } | undefined {
		const font = this.font(variant);
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
