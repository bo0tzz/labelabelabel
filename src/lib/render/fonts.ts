import * as hb from 'harfbuzzjs';

/** Settings of a variable font's axes. */
export interface Variant {
	weight?: number;
	fill?: boolean;
}

export interface ShapedGlyph {
	gid: number;
	/** Pen position in font units of the run's main font. */
	x: number;
	y: number;
	/** Set when the glyph comes from a fallback font. */
	font?: LoadedFont;
	/** The fallback font's units per main font unit. */
	ratio?: number;
}

export interface ShapedRun {
	glyphs: ShapedGlyph[];
	advance: number;
	/** Characters the font has no glyph for. */
	missing: string[];
}

const PRIVATE_USE = /\p{Co}/u;

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

	glyphOf(char: string): number {
		return this.font().glyph(char.codePointAt(0)!) ?? 0;
	}

	hasChar(codePoint: number): boolean {
		return !!this.font().glyph(codePoint);
	}

	/** Ink box of a glyph in font units, y up; undefined for glyphs without ink. */
	extents(gid: number, variant?: Variant) {
		return this.font(variant).glyphExtents(gid);
	}

	/** Outline as SVG path data in font units, y up. */
	path(gid: number, variant?: Variant): string {
		return this.font(variant).glyphToPath(gid);
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
			if (!PRIVATE_USE.test(String.fromCodePoint(u))) continue;
			const gid = font.glyph(u);
			if (!gid || seen.has(gid)) continue;
			seen.add(gid);
			symbols.push(String.fromCodePoint(u));
		}
		return symbols;
	}
}

export class FontRegistry {
	#fonts = new Map<string, LoadedFont>();
	/** Font used for characters the chosen font lacks, such as emoji. */
	fallbackId: string | undefined;

	get fallback(): LoadedFont | undefined {
		return this.fallbackId ? this.#fonts.get(this.fallbackId) : undefined;
	}

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
