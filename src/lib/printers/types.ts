export type PrinterError =
	| 'offline'
	| 'no-media'
	| 'wrong-media'
	| 'cover-open'
	| 'cutter-jam'
	| 'overheat'
	| 'weak-battery';

export interface LoadedMedia {
	/** Geometry id, e.g. `tze-12`. */
	id: string;
	name: string;
	/** Identifies this kind of cassette as the printer reports it; used to recognise owned tapes. */
	key: string;
	kind: string;
	tape?: string;
	text?: string;
	/** Best guess at the product number, e.g. `TZe-231`. */
	partNumber?: string;
}

export interface PrinterStatus {
	online: boolean;
	busy: boolean;
	errors: PrinterError[];
	media: LoadedMedia | null;
}

export interface PrinterCapabilities {
	highRes: boolean;
	halfCut: boolean;
	chain: boolean;
	mirror: boolean;
	feed: boolean;
}

export interface PrinterInfo {
	id: string;
	name: string;
	model: string;
	capabilities: PrinterCapabilities;
}
