import { tapeLabel } from '#lib/colors.js';
import type { MediaRef } from '#lib/label/types.js';
import { getMedia } from '#lib/media.js';
import type { LoadedMedia } from './types.js';

/** Why a label can't print on the loaded tape. Only a colour mismatch can be overridden. */
export type TapeMismatch = 'no-tape' | 'size' | 'colour';

export function tapeMismatch(
	want: MediaRef,
	loaded: LoadedMedia | null | undefined
): TapeMismatch | null {
	if (!loaded) return 'no-tape';
	if (loaded.id !== want.id) return 'size';
	if ((want.tape && want.tape !== loaded.tape) || (want.text && want.text !== loaded.text)) {
		return 'colour';
	}
	return null;
}

/** The tape a label is waiting for, e.g. `24 mm` or `black on white`. */
export function wantedTape(want: MediaRef, mismatch: TapeMismatch): string {
	if (mismatch === 'colour') return tapeLabel(want);
	const name = getMedia(want.id)?.name ?? want.id;
	return want.tape || want.text ? `${name}, ${tapeLabel(want)}` : name;
}

/** Laminated tape is half cut unless asked otherwise, so the blank lead stays on the backing. */
export function defaultHalfCut(loaded: LoadedMedia | null | undefined) {
	return loaded?.kind === 'laminated';
}
