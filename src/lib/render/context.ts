import type { Align } from '#lib/label/types.js';
import type { FontRegistry } from './fonts.js';

export interface RenderOptions {
	fonts: FontRegistry;
	vars?: Record<string, string>;
}

/** A problem with the label, tied to a block and field where possible. */
export interface RenderIssue {
	blockId?: string;
	field?: string;
	message: string;
	/** Not a problem, just something worth showing, like how a QR code was sized. */
	info?: boolean;
}

export interface Context extends RenderOptions {
	portrait: boolean;
	dpiAcross: number;
	dpiAlong: number;
	/** Dots along the tape per dot across it. */
	k: number;
	issues: RenderIssue[];
}

/** Space a block may fill, in dots. Blocks return a bitmap exactly `height` tall. */
export interface Box {
	width?: number;
	height: number;
}

export function offset(free: number, align: Align | undefined, fallback: Align = 'center') {
	switch (align ?? fallback) {
		case 'start':
			return 0;
		case 'end':
			return free;
		default:
			return Math.floor(free / 2);
	}
}
