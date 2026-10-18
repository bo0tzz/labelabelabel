export interface FontEntry {
	id: string;
	name: string;
	source: 'bundled' | 'uploaded';
	/** Em size in pixels for fonts drawn on a pixel grid; sizes snap to multiples of it. */
	pixelEm?: number;
	/** Range of the weight axis for variable fonts. */
	weights?: [number, number];
	/** Symbol glyphs, with the code that types each one if the font has ligatures for it. */
	symbols?: { char: string; code?: string }[];
}

export const DEFAULT_FONT = 'atkinson-hyperlegible-next';
