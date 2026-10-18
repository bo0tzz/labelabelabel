export type PtMediaKind = 'laminated' | 'non-laminated' | 'hs21' | 'hs31';

export const MEDIA_TYPE_CODES: Record<PtMediaKind, number> = {
	laminated: 0x01,
	'non-laminated': 0x03,
	hs21: 0x11,
	hs31: 0x17
};

export interface PtMedia {
	kind: PtMediaKind;
	/** Width byte as reported in status and sent in ESC i z. Not always the physical width. */
	widthCode: number;
	name: string;
	widthMm: number;
	/** Unused pins on each side of the print area; the head has 128 pins. */
	marginPins: number;
	printPins: number;
}

type Row = [
	widthCode: number,
	name: string,
	widthMm: number,
	marginPins: number,
	printPins: number
];

const TZE: Row[] = [
	[4, '3.5 mm', 3.5, 52, 24],
	[6, '6 mm', 6, 48, 32],
	[9, '9 mm', 9, 39, 50],
	[12, '12 mm', 12, 29, 70],
	[18, '18 mm', 18, 8, 112],
	[24, '24 mm', 24, 0, 128]
];

const HS21: Row[] = [
	[6, 'HS 5.8 mm', 5.8, 50, 28],
	[9, 'HS 8.8 mm', 8.8, 40, 48],
	[12, 'HS 11.7 mm', 11.7, 31, 66],
	[18, 'HS 17.7 mm', 17.7, 11, 106],
	[24, 'HS 23.6 mm', 23.6, 0, 128]
];

const HS31: Row[] = [
	[5, 'HS 5.2 mm', 5.2, 54, 20],
	[9, 'HS 9.0 mm', 9, 42, 44],
	[11, 'HS 11.2 mm', 11.2, 39, 50],
	[21, 'HS 21 mm', 21, 4, 120]
];

function rows(kind: PtMediaKind, table: Row[]): PtMedia[] {
	return table.map(([widthCode, name, widthMm, marginPins, printPins]) => ({
		kind,
		widthCode,
		name,
		widthMm,
		marginPins,
		printPins
	}));
}

export const PT_MEDIA: PtMedia[] = [
	...rows('laminated', TZE),
	...rows('non-laminated', TZE),
	...rows('hs21', HS21),
	...rows('hs31', HS31)
];

export function findMedia(typeCode: number, widthCode: number): PtMedia | undefined {
	return PT_MEDIA.find((m) => MEDIA_TYPE_CODES[m.kind] === typeCode && m.widthCode === widthCode);
}

const PART_TAPE_DIGIT: Record<number, string> = {
	0x01: '2',
	0x03: '1',
	0x04: '4',
	0x05: '5',
	0x06: '6',
	0x07: '7',
	0x08: '3',
	0x09: '1',
	0x70: '2',
	0x90: '2',
	0x91: '6'
};
const PART_TEXT_DIGIT: Record<number, string> = {
	0x08: '1',
	0x04: '2',
	0x05: '3',
	0x0a: '4',
	0x01: '5'
};
const PART_WIDTH_DIGIT: Record<number, string> = {
	4: '0',
	6: '1',
	9: '2',
	12: '3',
	18: '4',
	24: '5'
};

/** Brother numbers cassettes as <prefix>-<tape colour><width><text colour>, e.g. TZe-231. */
export function guessPartNumber(media: PtMedia, tapeColor: number, textColor: number) {
	const tape = PART_TAPE_DIGIT[tapeColor];
	const text = PART_TEXT_DIGIT[textColor];
	const width = PART_WIDTH_DIGIT[media.widthCode];
	if (!tape || !text || !width) return undefined;
	if (media.kind === 'hs31') return undefined;
	const prefix =
		media.kind === 'hs21'
			? 'HSe-'
			: tapeColor === 0x90 || tapeColor === 0x91
				? 'TZe-FX'
				: media.kind === 'non-laminated'
					? 'TZe-N'
					: 'TZe-';
	return `${prefix}${tape}${width}${text}`;
}

export const TAPE_COLORS: Record<number, string> = {
	0x01: 'white',
	0x02: 'other',
	0x03: 'clear',
	0x04: 'red',
	0x05: 'blue',
	0x06: 'yellow',
	0x07: 'green',
	0x08: 'black',
	0x09: 'clear',
	0x20: 'matte white',
	0x21: 'matte clear',
	0x22: 'matte silver',
	0x23: 'satin gold',
	0x24: 'satin silver',
	0x30: 'blue',
	0x31: 'red',
	0x40: 'fluorescent orange',
	0x41: 'fluorescent yellow',
	0x50: 'berry pink',
	0x51: 'light gray',
	0x52: 'lime green',
	0x60: 'yellow',
	0x61: 'pink',
	0x62: 'blue',
	0x70: 'white',
	0x90: 'white',
	0x91: 'yellow',
	0xf0: 'cleaning',
	0xf1: 'stencil',
	0xff: 'incompatible'
};

export const TEXT_COLORS: Record<number, string> = {
	0x01: 'white',
	0x02: 'other',
	0x04: 'red',
	0x05: 'blue',
	0x08: 'black',
	0x0a: 'gold',
	0x62: 'blue',
	0xf0: 'cleaning',
	0xf1: 'stencil',
	0xff: 'incompatible'
};
