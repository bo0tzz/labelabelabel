import type { Bitmap } from '#lib/bitmap.js';
import type { MediaGeometry } from '#lib/media.js';
import type { PrinterCapabilities, PrinterStatus } from '#lib/printers/types.js';

export interface PrintJobOptions {
	name: string;
	media: MediaGeometry;
	highRes?: boolean;
	halfCut?: boolean;
	chain?: boolean;
	mirror?: boolean;
}

export interface SubmittedJob {
	/** Resolves once the printer reports the job finished, rejects if it failed. */
	done: Promise<void>;
	cancel(): Promise<void>;
}

export interface PrinterDriver {
	readonly model: string;
	readonly capabilities: PrinterCapabilities;
	status(): Promise<PrinterStatus>;
	/** Each page is cut (or half cut) from the next. */
	print(pages: Bitmap[], options: PrintJobOptions): Promise<SubmittedJob>;
	/** Feeds out and cuts whatever is between the print head and the cutter. */
	feed?(media: MediaGeometry): Promise<SubmittedJob>;
	close(): void;
}
