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
		const ligatures = readLigatures(schraubenkiste.face.referenceTable('GSUB')!.slice());
		expect(ligatures.length).toBeGreaterThan(50);
		expect(ligatures.every((l) => l.components.length >= 2)).toBe(true);
	});

	it('finds the codes that type each symbol', () => {
		const names = schraubenkiste.symbolNames();
		expect(names.get('')?.[0]).toBe('TX');
		expect(names.get('')?.[0]).toBe('PH');
		expect(names.get('')?.[0]).toBe('ATX');
	});

	it('reads icon names in lowercase', () => {
		const icons = new LoadedFont(
			'icons',
			readFileSync('fonts/material-symbols/MaterialSymbolsOutlined.ttf')
		);
		expect(icons.symbolNames().get('')).toContain('home');
		expect(icons.hasFill).toBe(true);
	});

	it('has no names for fonts without symbols', () => {
		const sans = new LoadedFont(
			'sans',
			readFileSync('fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext.ttf')
		);
		expect(sans.symbolNames().size).toBe(0);
	});
});
