import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { error } from '@sveltejs/kit';
import { fontPath } from '#lib/server/fonts.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const path = fontPath(params.id);
	if (!path) error(404, 'font not found');
	return new Response(readFileSync(path), {
		headers: {
			'content-type': extname(path).toLowerCase() === '.otf' ? 'font/otf' : 'font/ttf',
			'cache-control': 'public, max-age=86400'
		}
	});
};
