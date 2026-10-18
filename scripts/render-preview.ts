/**
 * Renders sample labels to PNG for checking the renderer without printing.
 *
 *   tsx scripts/render-preview.ts <outdir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Label } from '../src/lib/label/types.js';
import { getMedia } from '../src/lib/media.js';
import { FontRegistry } from '../src/lib/render/fonts.js';
import { renderLabel } from '../src/lib/render/render.js';
import { bitmapToPng } from '../src/lib/server/png.js';
import { initServerRaster } from '../src/lib/server/raster.js';

await initServerRaster();

const fonts = new FontRegistry();
const add = (id: string, path: string) => {
	const font = fonts.add(id, readFileSync(path));
	console.log(
		`${id}: upem ${font.upem}, pixel em ${font.pixelEm ?? '-'}, wght ${JSON.stringify(font.weightAxis)}`
	);
};
add('atkinson', 'fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext.ttf');
add('departure', 'fonts/departure-mono/DepartureMono-Regular.otf');
add('schraubenkiste', 'fonts/schraubenkiste/Schraubenkiste.ttf');
add('schraubenkiste2', 'fonts/schraubenkiste/Schraubenkiste2.ttf');
add('silkscreen', 'fonts/silkscreen/Silkscreen-Regular.ttf');

const samples: Record<string, Label> = {
	sans12: {
		v: 1,
		media: { id: 'tze-12' },
		blocks: [{ id: 'a', type: 'text', text: 'Hello, Labels!', font: 'atkinson' }]
	},
	twoLines12: {
		v: 1,
		media: { id: 'tze-12' },
		blocks: [
			{ id: 'q', type: 'qr', data: 'https://example.com/item/42' },
			{ id: 'l', type: 'line', thickness: 1 },
			{ id: 't', type: 'text', text: 'Box 42\nCables & adapters', font: 'atkinson', weight: 600 }
		]
	},
	schraube12: {
		v: 1,
		media: { id: 'tze-12' },
		blocks: [{ id: 'a', type: 'text', text: 'Schraubenkiste M3', font: 'schraubenkiste' }]
	},
	schraube2_12: {
		v: 1,
		media: { id: 'tze-12' },
		blocks: [{ id: 'a', type: 'text', text: 'Schraubenkiste M3', font: 'schraubenkiste2' }]
	},
	sans6: {
		v: 1,
		media: { id: 'tze-6' },
		blocks: [{ id: 'a', type: 'text', text: 'Small tape 6mm', font: 'atkinson' }]
	},
	schraube6: {
		v: 1,
		media: { id: 'tze-6' },
		blocks: [{ id: 'a', type: 'text', text: 'Schraubenkiste M3', font: 'schraubenkiste' }]
	},
	departure6: {
		v: 1,
		media: { id: 'tze-6' },
		blocks: [{ id: 'a', type: 'text', text: 'Departure Mono 6mm', font: 'departure' }]
	},
	silkscreen35: {
		v: 1,
		media: { id: 'tze-3.5' },
		blocks: [{ id: 'a', type: 'text', text: 'SILKSCREEN 3.5MM', font: 'silkscreen' }]
	},
	silkscreenTight35: {
		v: 1,
		media: { id: 'tze-3.5' },
		blocks: [{ id: 'a', type: 'text', text: 'SILKSCREEN 3.5MM', font: 'silkscreen', tight: true }]
	},
	capsTight12: {
		v: 1,
		media: { id: 'tze-12' },
		blocks: [
			{ id: 'a', type: 'text', text: 'SERVER RACK', font: 'atkinson', weight: 700, tight: true }
		]
	},
	sans35: {
		v: 1,
		media: { id: 'tze-3.5' },
		blocks: [{ id: 'a', type: 'text', text: 'Sans on 3.5mm', font: 'atkinson', weight: 700 }]
	},
	hires12: {
		v: 1,
		media: { id: 'tze-12' },
		highRes: true,
		blocks: [{ id: 'a', type: 'text', text: 'High-res text', font: 'atkinson' }]
	},
	vars24: {
		v: 1,
		media: { id: 'tze-24' },
		length: 60,
		blocks: [
			{
				id: 't',
				type: 'text',
				text: '{{name}}\n{{location}}',
				font: 'atkinson',
				textAlign: 'center'
			}
		]
	}
};

const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const [name, label] of Object.entries(samples)) {
	const media = getMedia(label.media.id)!;
	const result = renderLabel(label, media, {
		fonts,
		vars: { name: 'Soldering iron', location: 'Shelf B2' }
	});
	const k = result.dpi.along / result.dpi.across;
	writeFileSync(join(out, `${name}.png`), bitmapToPng(result.bitmap, 6 / k, 6));
	console.log(
		`${name}: ${result.bitmap.width}x${result.bitmap.height}, tape ${result.tapeMm.toFixed(1)} mm` +
			(result.issues.length ? `, issues: ${result.issues.map((i) => i.message).join('; ')}` : '')
	);
}
