import * as fontkit from 'fontkit';
import type { LoadedFont } from '#lib/render/fonts.js';

/** A ligature the font's GSUB table defines: typing `name` gives `glyph`. */
export interface Ligature {
	glyph: number;
	name: string;
}

// fontkit hands out lazily parsed arrays for big tables; fontkit's types don't cover GSUB.
type Items<T> = T[] | { toArray(): T[] } | undefined;
const items = <T>(list: Items<T>): T[] =>
	list && 'toArray' in list ? list.toArray() : (list ?? []);

interface Coverage {
	glyphs?: Items<number>;
	rangeRecords?: Items<{ start: number; end: number }>;
}

interface SubTable {
	lookupType?: number;
	extension?: SubTable;
	coverage?: Coverage;
	ligatureSets?: Items<Items<{ glyph: number; components: Items<number> }>>;
}

interface Lookup {
	lookupType: number;
	subTables: Items<SubTable>;
}

const LIGATURE = 4;
const EXTENSION = 7;

function coverageGlyphs(coverage: Coverage): number[] {
	if (coverage.glyphs) return items(coverage.glyphs);
	return items(coverage.rangeRecords).flatMap(({ start, end }) =>
		Array.from({ length: end - start + 1 }, (_, i) => start + i)
	);
}

/** Reads all ligature substitutions and spells out the characters that form them. */
export function readLigatures(data: Uint8Array): Ligature[] {
	const font = fontkit.create(Buffer.from(data)) as fontkit.Font;

	// Icon fonts often map both cases to one glyph; names read better in lowercase.
	const chars = new Map<number, string>();
	for (const cp of font.characterSet) {
		const gid = font.glyphForCodePoint(cp).id;
		const char = String.fromCodePoint(cp);
		if (!chars.has(gid) || char !== char.toUpperCase()) chars.set(gid, char);
	}

	const ligatures: Ligature[] = [];
	const gsub = (font as unknown as { GSUB?: { lookupList: Items<Lookup> } }).GSUB;
	for (const lookup of items(gsub?.lookupList)) {
		for (let table of items(lookup.subTables)) {
			let type = lookup.lookupType;
			if (type === EXTENSION && table.extension) {
				type = table.lookupType ?? type;
				table = table.extension;
			}
			if (type !== LIGATURE || !table.coverage) continue;
			const first = coverageGlyphs(table.coverage);
			items(table.ligatureSets).forEach((set, i) => {
				for (const ligature of items(set)) {
					const name = [first[i], ...items(ligature.components)].map((g) => chars.get(g));
					if (name.every((c) => c !== undefined)) {
						ligatures.push({ glyph: ligature.glyph, name: name.join('') });
					}
				}
			});
		}
	}
	return ligatures;
}

/**
 * Names that a font's ligatures turn into each of its symbols, like `TX` in Schraubenkiste or
 * `home` in Material Symbols, shortest first. Only names that really shape to the symbol count.
 */
export function symbolNames(font: LoadedFont, data: Uint8Array): Map<string, string[]> {
	const names = new Map<string, string[]>();
	const symbols = font.symbols();
	if (!symbols.length) return names;
	const symbolByGlyph = new Map(symbols.map((symbol) => [font.glyphOf(symbol), symbol]));
	for (const { glyph, name } of readLigatures(data)) {
		const symbol = symbolByGlyph.get(glyph);
		if (!symbol) continue;
		const shaped = font.shape(name).glyphs;
		if (shaped.length !== 1 || shaped[0].gid !== glyph) continue;
		const list = names.get(symbol) ?? [];
		if (!list.includes(name)) list.push(name);
		names.set(symbol, list);
	}
	for (const list of names.values()) list.sort((a, b) => a.length - b.length);
	return names;
}
