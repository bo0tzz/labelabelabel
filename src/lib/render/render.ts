import { blit, createBitmap, type Bitmap } from '#lib/bitmap.js';
import type { Label } from '#lib/label/types.js';
import { dotsToMm, mmToDots, type MediaGeometry } from '#lib/media.js';
import { renderBlock } from './blocks.js';
import { offset, type Context, type RenderIssue, type RenderOptions } from './context.js';

export type { RenderIssue, RenderOptions } from './context.js';

/** Where a block ended up, in dots: x along the tape, y across it. */
export interface BlockLayout {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RenderedLabel {
	/** Height is the printable dots across the tape; width is in dots along it. */
	bitmap: Bitmap;
	dpi: { along: number; across: number };
	blocks: BlockLayout[];
	/** Length of the piece of tape the printer cuts. */
	tapeMm: number;
	/** Nothing gets ink, e.g. the only text is empty. */
	empty: boolean;
	issues: RenderIssue[];
}

interface Placed {
	id: string;
	bitmap: Bitmap;
	x: number;
	y: number;
}

function layoutRow(label: Label, height: number, ctx: Context) {
	const gap = mmToDots(label.gap ?? 2, ctx.dpiAlong);
	const placed: Placed[] = [];
	let x = 0;
	for (const block of label.blocks) {
		const width = block.width !== undefined ? mmToDots(block.width, ctx.dpiAlong) : undefined;
		const bitmap = renderBlock(block, { width, height }, ctx);
		if (bitmap.width > 0 && placed.some((p) => p.bitmap.width > 0)) x += gap;
		placed.push({ id: block.id, bitmap, x, y: 0 });
		x += bitmap.width;
	}
	return { placed, start: 0, end: x };
}

function layoutFree(label: Label, height: number, ctx: Context) {
	const placed: Placed[] = [];
	let start = Infinity;
	let end = 0;
	for (const block of label.blocks) {
		if (block.type === 'space') continue;
		// A drawing's box is its canvas, so resizing it crops or extends rather than stretches.
		const box =
			block.type === 'bitmap'
				? { height: Math.round((block.h * ctx.dpiAcross) / block.dpi[1]) }
				: {
						width: block.width !== undefined ? mmToDots(block.width, ctx.dpiAlong) : undefined,
						height: block.height !== undefined ? mmToDots(block.height, ctx.dpiAcross) : height
					};
		const bitmap = renderBlock(block, box, ctx);
		const x = mmToDots(block.x ?? 0, ctx.dpiAlong);
		const y = mmToDots(block.y ?? 0, ctx.dpiAcross);
		if (y < 0 || y + box.height > height) {
			ctx.issues.push({ blockId: block.id, message: 'sticks out of the printable area' });
		}
		placed.push({ id: block.id, bitmap, x, y });
		if (bitmap.width > 0) {
			start = Math.min(start, x);
			end = Math.max(end, x + bitmap.width);
		}
	}
	return { placed, start: Math.min(0, start), end };
}

export function renderLabel(
	label: Label,
	media: MediaGeometry,
	options: RenderOptions
): RenderedLabel {
	const dpiAcross = media.dpi;
	const dpiAlong = label.highRes && media.highRes ? dpiAcross * 2 : dpiAcross;
	const ctx: Context = {
		...options,
		portrait: label.orientation === 'portrait',
		dpiAcross,
		dpiAlong,
		k: dpiAlong / dpiAcross,
		issues: []
	};
	const height = media.dots;

	const free = label.layout === 'free';
	const { placed, start, end } = free
		? layoutFree(label, height, ctx)
		: layoutRow(label, height, ctx);
	const content = end - start;
	const padding = mmToDots(label.padding ?? 0, dpiAlong);
	const feed = media.feedMm * 2;
	const minData = mmToDots(media.minLengthMm, dpiAlong);

	let width = Math.max(minData, content + padding * 2);
	// Where content position 0 lands on the label.
	let origin = padding - start;
	if (label.length !== undefined) {
		if (label.length < media.minTapeMm) {
			ctx.issues.push({
				field: 'length',
				message: `the printer cannot cut labels shorter than ${media.minTapeMm} mm`
			});
		}
		const fixed = Math.max(minData, mmToDots(label.length - feed, dpiAlong));
		if (content + padding * 2 > fixed) {
			ctx.issues.push({ field: 'length', message: 'content is longer than the label' });
		}
		if (!free) origin += offset(fixed - content - padding * 2, label.justify);
		width = fixed;
	} else if (!free) {
		origin += Math.floor((width - content - padding * 2) / 2);
	}
	const maxData = mmToDots(media.maxLengthMm, dpiAlong);
	if (width > maxData) {
		ctx.issues.push({ field: 'length', message: `labels can be at most ${media.maxLengthMm} mm` });
		width = maxData;
	}

	const bitmap = createBitmap(width, height);
	const blocks: BlockLayout[] = [];
	for (const p of placed) {
		const x = origin + p.x;
		blocks.push({ id: p.id, x, y: p.y, width: p.bitmap.width, height: p.bitmap.height });
		if (p.bitmap.width) blit(bitmap, p.bitmap, x, p.y);
	}

	return {
		bitmap,
		dpi: { along: dpiAlong, across: dpiAcross },
		blocks,
		tapeMm: Math.max(media.minTapeMm, dotsToMm(width, dpiAlong) + feed),
		empty: !bitmap.data.includes(1),
		issues: ctx.issues
	};
}
