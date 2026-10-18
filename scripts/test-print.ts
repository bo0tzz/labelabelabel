/**
 * Prints calibration labels to a PT-P750W.
 *
 *   tsx scripts/test-print.ts <host> <basic|hires|ipp> [--preview <dir>] [--out <file>]
 *
 * --preview writes PNGs instead of printing, --out writes the raw job instead of sending it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import {
	createBitmap,
	fillRect,
	setPixel,
	strokeRect,
	blit,
	type Bitmap
} from '../src/lib/bitmap.js';
import type { PtMedia } from '../src/lib/printers/brother-pt/media.js';
import { bitmapToPng } from '../src/lib/server/png.js';
import { encodeJob } from '../src/lib/server/printers/brother-pt/raster.js';
import { PtSnmp, type PtSnmpReading } from '../src/lib/server/printers/brother-pt/snmp.js';
import { sendRaw } from '../src/lib/server/printers/brother-pt/transport.js';
import { drawText, textWidth } from './font5x7.js';

function hconcat(height: number, parts: Bitmap[], gap: number, pad: number): Bitmap {
	const width = parts.reduce((w, p) => w + p.width, 0) + gap * (parts.length - 1) + pad * 2;
	const out = createBitmap(width, height);
	let x = pad;
	for (const part of parts) {
		blit(out, part, x, 0);
		x += part.width + gap;
	}
	return out;
}

function pattern(w: number, h: number, on: (x: number, y: number) => boolean): Bitmap {
	const b = createBitmap(w, h);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) setPixel(b, x, y);
	return b;
}

function labelled(h: number, body: Bitmap, label: string, scaleX = 1): Bitmap {
	const b = createBitmap(Math.max(body.width, textWidth(label, scaleX)), h);
	blit(b, body, 0, 0);
	drawText(b, 0, h - 8, label, scaleX, 1);
	return b;
}

function qr(text: string, module: number, h: number): Bitmap {
	const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const size = modules.size * module;
	const b = createBitmap(size, h);
	const top = Math.floor((h - size) / 2);
	for (let r = 0; r < modules.size; r++) {
		for (let c = 0; c < modules.size; c++) {
			if (modules.get(r, c)) fillRect(b, c * module, top + r * module, module, module);
		}
	}
	return b;
}

function basicLabel(h: number): Bitmap {
	const frame = createBitmap(180, h);
	strokeRect(frame, 0, 0, 180, h);
	drawText(frame, 12, 6, 'LABELABELABEL', 2);
	drawText(frame, 12, 26, 'TEST 1');
	drawText(frame, 12, 38, 'BOX 180 DOTS = 25.4MM');
	drawText(frame, 12, 50, `${h} DOTS = ${((h * 25.4) / 180).toFixed(1)}MM`);

	const ph = h - 12;
	const lines = [
		labelled(
			h,
			pattern(24, ph, (x) => x % 2 === 0),
			'V1'
		),
		labelled(
			h,
			pattern(24, ph, (x) => x % 4 < 2),
			'V2'
		),
		labelled(
			h,
			pattern(24, ph, (_, y) => y % 2 === 0),
			'H1'
		),
		labelled(
			h,
			pattern(24, ph, (_, y) => y % 4 < 2),
			'H2'
		),
		labelled(
			h,
			pattern(24, ph, (x, y) => (x + y) % 2 === 0),
			'C1'
		),
		labelled(
			h,
			pattern(24, ph, (x, y) => ((x >> 1) + (y >> 1)) % 2 === 0),
			'C2'
		),
		labelled(
			h,
			pattern(19, ph, (x) => x === 0 || x === 4 || x === 5 || (x >= 9 && x <= 11) || x >= 15),
			'1234'
		)
	];

	const bandsWidth = 130;
	const bands = createBitmap(bandsWidth, h);
	strokeRect(bands, 0, 1, bandsWidth, 26);
	drawText(bands, 3, 3, '3.5MM', 3);
	drawText(bands, 96, 10, 'AB12');
	strokeRect(bands, 0, 34, bandsWidth, 34);
	drawText(bands, 3, 37, '6MM', 4);
	drawText(bands, 76, 44, 'AB12', 2, 2);

	return hconcat(
		h,
		[
			frame,
			hconcat(h, lines, 8, 0),
			bands,
			qr('LABELABELABEL 2', 2, h),
			qr('LABELABELABEL 3', 3, h)
		],
		16,
		0
	);
}

function disc(w: number, h: number): Bitmap {
	return pattern(w, h, (x, y) => {
		const dx = (x + 0.5 - w / 2) / (w / 2);
		const dy = (y + 0.5 - h / 2) / (h / 2);
		return dx * dx + dy * dy <= 1;
	});
}

function doubleX(b: Bitmap): Bitmap {
	return pattern(b.width * 2, b.height, (x, y) => b.data[y * b.width + (x >> 1)] === 1);
}

/** Bitmap along-tape units are 360 dpi here; ×2 horizontal scale keeps 180 dpi shapes. */
function hiresLabel(h: number): Bitmap {
	const title = createBitmap(150, h);
	drawText(title, 0, 4, 'HI-RES', 4, 2);
	drawText(title, 0, 24, 'TEST 2', 2, 1);
	drawText(title, 0, 36, '180X360', 2, 1);

	const ph = h - 12;
	const stripes = [
		labelled(
			h,
			pattern(72, ph, (x) => x % 2 === 0),
			'1',
			2
		),
		labelled(
			h,
			pattern(72, ph, (x) => x % 4 < 2),
			'2',
			2
		),
		labelled(
			h,
			pattern(72, ph, (x) => x % 8 < 4),
			'4',
			2
		)
	];

	const text = createBitmap(200, h);
	drawText(text, 0, 10, 'NARROW TEXT', 1, 1);
	drawText(text, 0, 30, 'NORMAL TEXT', 2, 1);

	const discs = [labelled(h, disc(100, 51), 'HR', 2), labelled(h, doubleX(disc(50, 51)), 'NR', 2)];

	return hconcat(h, [title, hconcat(h, stripes, 24, 0), text, hconcat(h, discs, 24, 0)], 40, 0);
}

function ippLabel(h: number): Bitmap {
	const b = createBitmap(150, h);
	drawText(b, 0, 6, 'IPP', 4);
	drawText(b, 0, 44, 'TEST 3', 2);
	return b;
}

function fmt(r: PtSnmpReading) {
	const s = r.status;
	return [
		`hr=${r.hrStatus}`,
		`type=${s.statusType}`,
		`phase=${s.phaseType}/${s.phase}`,
		`notif=${s.notification}`,
		`errors=${s.errors.join(',') || '-'}`,
		`raw=${Buffer.from(r.raw).toString('hex')}`
	].join(' ');
}

async function monitor(snmp: PtSnmp, run: () => Promise<void>) {
	const start = Date.now();
	const log = (msg: string) => console.log(`${((Date.now() - start) / 1000).toFixed(2)}s ${msg}`);
	let last = '';
	let sent = false;
	let sentAt = 0;
	let sawBusy = false;
	let idleSince = 0;

	const poll = async () => {
		try {
			const reading = await snmp.read();
			const line = fmt(reading);
			if (line !== last) log(line);
			last = line;
			const busy = reading.hrStatus !== 'idle' || reading.status.phaseType !== 0;
			if (busy) {
				sawBusy = true;
				idleSince = 0;
			} else if (!idleSince) {
				idleSince = Date.now();
			}
		} catch (e) {
			log(`snmp error: ${(e as Error).message}`);
		}
	};

	await poll();
	const sending = run().then(() => {
		sent = true;
		sentAt = Date.now();
		log('job sent');
	});
	while (true) {
		await new Promise((r) => setTimeout(r, 250));
		await poll();
		if (!sent) continue;
		const idleFor = idleSince ? Date.now() - idleSince : 0;
		if (sawBusy && idleFor > 3000) break;
		if (!sawBusy && Date.now() - sentAt > 20000) break;
		if (Date.now() - start > 90000) break;
	}
	await sending;
	log(sawBusy ? 'done' : 'done (never saw a busy state)');
}

async function main() {
	const args = process.argv.slice(2);
	const flag = (name: string) => {
		const i = args.indexOf(name);
		return i === -1 ? undefined : args.splice(i, 2)[1];
	};
	const previewDir = flag('--preview');
	const outFile = flag('--out');
	const [host, which] = args;
	if (!host || !which) throw new Error('usage: test-print.ts <host> <basic|hires|ipp>');

	const snmp = new PtSnmp(host);
	try {
		const { status } = await snmp.read();
		if (status.errors.length) throw new Error(`printer reports: ${status.errors.join(', ')}`);
		const media: PtMedia | undefined = status.media;
		if (!media)
			throw new Error(`unknown media type=${status.mediaType} width=${status.mediaWidth}`);
		if (media.printPins < 70) throw new Error(`test labels need at least 12 mm tape`);
		console.log(
			`loaded: ${media.name} ${media.kind}, ${status.tapeColorName}/${status.textColorName}`
		);

		const h = media.printPins;
		const highRes = which === 'hires';
		const page =
			which === 'basic'
				? basicLabel(h)
				: highRes
					? hiresLabel(h)
					: which === 'ipp'
						? ippLabel(h)
						: undefined;
		if (!page) throw new Error(`unknown label ${which}`);
		const along = highRes ? 360 : 180;
		console.log(`${which}: ${page.width} lines, ${((page.width * 25.4) / along).toFixed(1)} mm`);

		if (previewDir) {
			mkdirSync(previewDir, { recursive: true });
			const file = join(previewDir, `${which}.png`);
			writeFileSync(file, highRes ? bitmapToPng(page, 2, 4) : bitmapToPng(page, 4));
			console.log(`wrote ${file}`);
			return;
		}

		const job = encodeJob([page], { media, highRes });
		if (outFile) {
			writeFileSync(outFile, job);
			console.log(`wrote ${job.length} bytes to ${outFile}`);
			return;
		}
		await monitor(snmp, () => sendRaw(host, job));
	} finally {
		snmp.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
