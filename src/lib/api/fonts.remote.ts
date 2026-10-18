import * as v from 'valibot';
import { command, form, query } from '$app/server';
import { addFont, listFonts as list, removeFont } from '#lib/server/fonts.js';

export const listFonts = query(() => list());

export const uploadFont = form(v.object({ file: v.file() }), async ({ file }) => {
	const font = addFont(file.name, new Uint8Array(await file.arrayBuffer()));
	void listFonts().refresh();
	return font;
});

export const deleteFont = command(v.string(), (id) => {
	removeFont(id);
	void listFonts().refresh();
});
