import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { eq } from 'drizzle-orm';
import { DATA_DIR, FONTS_DIR } from '$app/env/private';
import type { FontEntry } from '#lib/fonts.js';
import { FontRegistry } from '#lib/render/fonts.js';
import { db, fonts as fontsTable } from './db/index.js';

const FONT_EXTENSIONS = ['.ttf', '.otf'];
const uploadDir = join(DATA_DIR, 'fonts');

interface StoredFont {
	entry: FontEntry;
	path: string;
}

export function fontId(file: string) {
	return basename(file, extname(file))
		.replace(/([a-z])([A-Z])/g, '$1-$2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-(regular)$/, '')
		.replace(/^-|-$/g, '');
}

function scan(dir: string): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true, recursive: true });
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.isFile() && FONT_EXTENSIONS.includes(extname(e.name).toLowerCase()))
		.map((e) => join(e.parentPath, e.name));
}

export const registry = new FontRegistry();
const catalog = new Map<string, StoredFont>();

function register(id: string, path: string, source: FontEntry['source'], name?: string) {
	try {
		const font = registry.add(id, readFileSync(path));
		const codes = font.symbolCodes();
		// Ligatures without letters, like Schraubenkiste's small decimals, apply on their own.
		const symbols = font
			.symbols()
			.map((char) => ({ char, code: codes.get(char) }))
			.filter(({ code }) => code === undefined || /\p{L}/u.test(code));
		catalog.set(id, {
			entry: {
				id,
				name: name ?? font.name,
				source,
				pixelEm: font.pixelEm,
				weights: font.weightAxis ? [font.weightAxis.min, font.weightAxis.max] : undefined,
				symbols: symbols.length ? symbols : undefined
			},
			path
		});
	} catch (e) {
		console.warn(`skipping font ${relative('.', path)}: ${(e as Error).message}`);
	}
}

/** Optional `fonts.json` next to the bundled fonts, mapping font ids to display names. */
function bundledNames(): Record<string, { name?: string }> {
	try {
		return JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8'));
	} catch {
		return {};
	}
}

export function loadFonts() {
	const names = bundledNames();
	for (const path of scan(FONTS_DIR)) {
		const id = fontId(path);
		register(id, path, 'bundled', names[id]?.name);
	}
	for (const row of db.select().from(fontsTable).all()) {
		register(row.id, join(uploadDir, row.file), 'uploaded', row.name);
	}
}

export function listFonts(): FontEntry[] {
	return [...catalog.values()].map((f) => f.entry).sort((a, b) => a.name.localeCompare(b.name));
}

export function fontPath(id: string): string | undefined {
	return catalog.get(id)?.path;
}

export function addFont(fileName: string, data: Uint8Array): FontEntry {
	const ext = extname(fileName).toLowerCase();
	if (!FONT_EXTENSIONS.includes(ext)) throw new Error('only TTF and OTF fonts are supported');
	let id = fontId(fileName) || 'font';
	while (catalog.has(id)) id += '-2';
	mkdirSync(uploadDir, { recursive: true });
	const file = `${id}${ext}`;
	const path = join(uploadDir, file);
	writeFileSync(path, data);
	register(id, path, 'uploaded');
	const stored = catalog.get(id);
	if (!stored) {
		rmSync(path, { force: true });
		throw new Error('not a usable font file');
	}
	db.insert(fontsTable).values({ id, name: stored.entry.name, file }).run();
	return stored.entry;
}

export function removeFont(id: string) {
	const stored = catalog.get(id);
	if (!stored || stored.entry.source !== 'uploaded') {
		throw new Error('only uploaded fonts can be removed');
	}
	db.delete(fontsTable).where(eq(fontsTable.id, id)).run();
	rmSync(stored.path, { force: true });
	catalog.delete(id);
}
