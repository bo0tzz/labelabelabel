import { defineEnvVars } from '@sveltejs/kit/env';

const withDefault = (fallback: string) => (value: string | undefined) => value || fallback;

export const variables = defineEnvVars({
	DATA_DIR: {
		description: 'Directory for the database and uploaded fonts.',
		schema: withDefault('./data')
	},
	FONTS_DIR: {
		description: 'Directory with the bundled fonts.',
		schema: withDefault('./fonts')
	},
	PRINTER_HOST: {
		description: 'Address of a Brother PT printer. Leave empty to configure printers in the app.',
		schema: withDefault('')
	},
	PRINTER_TRANSPORT: {
		description: '`ipp` (default, tracks jobs) or `raw` (port 9100).',
		schema: withDefault('ipp')
	},
	USER_HEADER: {
		description:
			'Request header with the user name set by a forward-auth proxy, e.g. `remote-user`.',
		schema: withDefault('')
	}
});
