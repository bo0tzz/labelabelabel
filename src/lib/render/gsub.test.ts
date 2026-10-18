import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LoadedFont } from './fonts.js';
import { readLigatures } from './gsub.js';

const schraubenkiste = new LoadedFont(
	'schraubenkiste',
	readFileSync('fonts/schraubenkiste/Schraubenkiste.ttf')
);

describe('readLigatures', () => {
	it('reads the ligature table of a font', () => {
		const ligatures = readLigatures(schraubenkiste.face.referenceTable('GSUB')!);
		expect(ligatures.length).toBeGreaterThan(50);
		expect(ligatures.every((l) => l.components.length >= 2)).toBe(true);
	});

	it('finds the codes that type each symbol', () => {
		const codes = schraubenkiste.symbolCodes();
		expect(codes.get('')).toBe('TX');
		expect(codes.get('')).toBe('PH');
		expect(codes.get('')).toBe('ATX');
	});

	it('has no codes for fonts without symbols', () => {
		const sans = new LoadedFont(
			'sans',
			readFileSync('fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext.ttf')
		);
		expect(sans.symbolCodes().size).toBe(0);
	});
});
