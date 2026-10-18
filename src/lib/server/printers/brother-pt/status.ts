import {
	findMedia,
	TAPE_COLORS,
	TEXT_COLORS,
	type PtMedia
} from '#lib/printers/brother-pt/media.js';

export type PtError =
	| 'no-media'
	| 'cutter-jam'
	| 'weak-battery'
	| 'high-voltage-adapter'
	| 'wrong-media'
	| 'cover-open'
	| 'overheat';

export interface PtStatus {
	modelCode: number;
	errors: PtError[];
	mediaWidth: number;
	mediaType: number;
	media: PtMedia | undefined;
	tapeColor: number;
	textColor: number;
	tapeColorName: string | undefined;
	textColorName: string | undefined;
	statusType: number;
	phaseType: number;
	phase: number;
	notification: number;
}

const ERROR_BITS_1: [number, PtError][] = [
	[0x01, 'no-media'],
	[0x04, 'cutter-jam'],
	[0x08, 'weak-battery'],
	[0x40, 'high-voltage-adapter']
];

const ERROR_BITS_2: [number, PtError][] = [
	[0x01, 'wrong-media'],
	[0x10, 'cover-open'],
	[0x20, 'overheat']
];

export function parseStatus(raw: Uint8Array): PtStatus {
	if (raw.length !== 32 || raw[0] !== 0x80 || raw[1] !== 0x20 || raw[2] !== 0x42) {
		throw new Error('not a Brother raster status block');
	}
	const errors: PtError[] = [
		...ERROR_BITS_1.filter(([mask]) => raw[8] & mask).map(([, e]) => e),
		...ERROR_BITS_2.filter(([mask]) => raw[9] & mask).map(([, e]) => e)
	];
	return {
		modelCode: raw[4],
		errors,
		mediaWidth: raw[10],
		mediaType: raw[11],
		media: findMedia(raw[11], raw[10]),
		tapeColor: raw[24],
		textColor: raw[25],
		tapeColorName: TAPE_COLORS[raw[24]],
		textColorName: TEXT_COLORS[raw[25]],
		statusType: raw[18],
		phaseType: raw[19],
		phase: (raw[20] << 8) | raw[21],
		notification: raw[22]
	};
}
