import { PT_MEDIA, type PtMedia } from '#lib/printers/brother-pt/media.js';

/** Printer-independent description of a medium, used for layout and preview. */
export interface MediaGeometry {
	id: string;
	name: string;
	widthMm: number;
	/** Printable dots across the tape. */
	dots: number;
	/** Resolution across the tape; along the tape it is this or a multiple in high-res mode. */
	dpi: number;
	highRes: boolean;
	minLengthMm: number;
	maxLengthMm: number;
	/** Shortest piece of tape the printer can cut. */
	minTapeMm: number;
	/** Blank tape the printer adds at each end. */
	feedMm: number;
}

const PT_FAMILY: Record<PtMedia['kind'], string> = {
	laminated: 'tze',
	'non-laminated': 'tze',
	hs21: 'hs21',
	hs31: 'hs31'
};

export function ptMediaId(media: PtMedia) {
	return `${PT_FAMILY[media.kind]}-${media.widthMm}`;
}

function fromPt(media: PtMedia): MediaGeometry {
	const heatShrink = media.kind === 'hs21' || media.kind === 'hs31';
	return {
		id: ptMediaId(media),
		name: media.name,
		widthMm: media.widthMm,
		dots: media.printPins,
		dpi: 180,
		// Brother only specifies 180×360 dpi for TZe tape.
		highRes: !heatShrink,
		minLengthMm: 4.4,
		maxLengthMm: heatShrink ? 500 : 1000,
		minTapeMm: 24.5,
		feedMm: 2
	};
}

export const MEDIA: MediaGeometry[] = [
	...new Map(PT_MEDIA.map((m) => [ptMediaId(m), fromPt(m)])).values()
];

export function getMedia(id: string): MediaGeometry | undefined {
	return MEDIA.find((m) => m.id === id);
}

export function mmToDots(mm: number, dpi: number) {
	return Math.round((mm * dpi) / 25.4);
}

export function dotsToMm(dots: number, dpi: number) {
	return (dots * 25.4) / dpi;
}

/** Identifies a tape by width and colours, e.g. to compare a label's tape with the loaded one. */
export function mediaKey(media: { id: string; tape?: string | null; text?: string | null }) {
	return `${media.id}|${media.tape ?? ''}|${media.text ?? ''}`;
}
