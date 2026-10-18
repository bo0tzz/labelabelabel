export interface FontEntry {
	id: string;
	name: string;
	source: 'bundled' | 'uploaded';
	/** Em size in pixels for fonts drawn on a pixel grid; sizes snap to multiples of it. */
	pixelEm?: number;
	/** Range of the weight axis for variable fonts. */
	weights?: [number, number];
	/** The font has a fill axis, so its glyphs can be filled instead of outlined. */
	fill?: boolean;
	/** Number of symbol glyphs; fetch them with `fontSymbols`. */
	symbols?: number;
}

/** A symbol glyph and the names its ligatures accept, shortest first. */
export interface FontSymbol {
	char: string;
	names: string[];
}

/** Fonts with this many symbols are icon fonts: they insert the symbol, not its name. */
export const ICON_FONT_SYMBOLS = 200;

export const DEFAULT_FONT = 'atkinson-hyperlegible-next';
