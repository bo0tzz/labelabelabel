/** A ligature from a font's GSUB table: these glyphs in sequence become `glyph`. */
export interface Ligature {
	glyph: number;
	components: number[];
}

const LIGATURE_SUBST = 4;
const EXTENSION_SUBST = 7;

function coverage(view: DataView, offset: number): number[] {
	const format = view.getUint16(offset);
	const glyphs: number[] = [];
	if (format === 1) {
		const count = view.getUint16(offset + 2);
		for (let i = 0; i < count; i++) glyphs.push(view.getUint16(offset + 4 + i * 2));
	} else if (format === 2) {
		const ranges = view.getUint16(offset + 2);
		for (let i = 0; i < ranges; i++) {
			const record = offset + 4 + i * 6;
			const start = view.getUint16(record);
			const end = view.getUint16(record + 2);
			for (let g = start; g <= end; g++) glyphs.push(g);
		}
	}
	return glyphs;
}

function ligatureSubtable(view: DataView, offset: number, out: Ligature[]) {
	if (view.getUint16(offset) !== 1) return;
	const firstGlyphs = coverage(view, offset + view.getUint16(offset + 2));
	const setCount = view.getUint16(offset + 4);
	for (let s = 0; s < setCount && s < firstGlyphs.length; s++) {
		const set = offset + view.getUint16(offset + 6 + s * 2);
		const count = view.getUint16(set);
		for (let l = 0; l < count; l++) {
			const lig = set + view.getUint16(set + 2 + l * 2);
			const componentCount = view.getUint16(lig + 2);
			const components = [firstGlyphs[s]];
			for (let c = 1; c < componentCount; c++) components.push(view.getUint16(lig + 2 + c * 2));
			out.push({ glyph: view.getUint16(lig), components });
		}
	}
}

/** Reads all ligature substitutions (lookup type 4, also inside extension lookups). */
export function readLigatures(gsub: Uint8Array): Ligature[] {
	const view = new DataView(gsub.buffer, gsub.byteOffset, gsub.byteLength);
	const ligatures: Ligature[] = [];
	const lookupList = view.getUint16(8);
	const lookupCount = view.getUint16(lookupList);
	for (let i = 0; i < lookupCount; i++) {
		const lookup = lookupList + view.getUint16(lookupList + 2 + i * 2);
		const type = view.getUint16(lookup);
		const subtables = view.getUint16(lookup + 4);
		for (let t = 0; t < subtables; t++) {
			let subtable = lookup + view.getUint16(lookup + 6 + t * 2);
			let subtableType = type;
			if (type === EXTENSION_SUBST) {
				subtableType = view.getUint16(subtable + 2);
				subtable += view.getUint32(subtable + 4);
			}
			if (subtableType === LIGATURE_SUBST) ligatureSubtable(view, subtable, ligatures);
		}
	}
	return ligatures;
}
