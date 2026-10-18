import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LoadedFont } from '#lib/render/fonts.js';
import { readLigatures, symbolNames } from './gsub.js';

const load = (file: string) => {
	const data = readFileSync(file);
	return { data, font: new LoadedFont(file, data) };
};

describe('symbolNames', () => {
	it('reads the ligature table of a font', () => {
		const { data } = load('fonts/schraubenkiste/Schraubenkiste.ttf');
		expect(readLigatures(data).map((l) => l.name)).toContain('TX');
	});

	it('finds the codes that type each symbol', () => {
		const { data, font } = load('fonts/schraubenkiste/Schraubenkiste.ttf');
		const names = symbolNames(font, data);
		expect(names.get('\ue002')?.[0]).toBe('TX');
		expect(names.get('\ue000')?.[0]).toBe('PH');
		expect(names.get('\ue003')?.[0]).toBe('ATX');
	});

	it('reads icon names in lowercase, including from extension lookups', () => {
		const { data, font } = load('fonts/material-symbols/MaterialSymbolsOutlined.ttf');
		expect(symbolNames(font, data).get('\ue88a')).toContain('home');
	});

	it('has no names for fonts without symbols', () => {
		const { data, font } = load('fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext.ttf');
		expect(symbolNames(font, data).size).toBe(0);
	});
});
