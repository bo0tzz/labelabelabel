import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { USER_HEADER } from '$app/env/private';
import { loadFonts } from '#lib/server/fonts.js';
import { printers } from '#lib/server/printers/service.js';

export const init: ServerInit = () => {
	loadFonts();
	printers.start();
};

export const handle: Handle = ({ event, resolve }) => {
	event.locals.user = (USER_HEADER && event.request.headers.get(USER_HEADER)) || undefined;
	return resolve(event);
};
