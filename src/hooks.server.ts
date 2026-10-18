import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { USER_HEADER } from '$app/env/private';
import { loadFonts } from '#lib/server/fonts.js';
import { initServerRaster } from '#lib/server/raster.js';
import { startPrinters } from '#lib/server/printers/index.js';

export const init: ServerInit = async () => {
	await initServerRaster();
	loadFonts();
	startPrinters();
};

export const handle: Handle = ({ event, resolve }) => {
	event.locals.user = (USER_HEADER && event.request.headers.get(USER_HEADER)) || undefined;
	return resolve(event);
};
