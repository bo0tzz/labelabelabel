import * as v from 'valibot';
import type { Label } from './types.js';

const align = v.optional(v.picklist(['start', 'center', 'end']));
const mm = v.pipe(v.number(), v.minValue(0), v.maxValue(1000));
const position = v.pipe(v.number(), v.minValue(-1000), v.maxValue(1000));
const base = {
	id: v.pipe(v.string(), v.maxLength(64)),
	width: v.optional(mm),
	height: v.optional(mm),
	x: v.optional(position),
	y: v.optional(position),
	align
};

export const blockSchema = v.variant('type', [
	v.object({
		...base,
		type: v.literal('text'),
		text: v.pipe(v.string(), v.maxLength(2000)),
		font: v.string(),
		size: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(500))),
		tight: v.optional(v.boolean()),
		weight: v.optional(v.number()),
		filled: v.optional(v.boolean()),
		textAlign: align,
		rotate: v.optional(v.picklist([0, 90, 180, 270])),
		stack: v.optional(v.boolean()),
		lineHeight: v.optional(v.pipe(v.number(), v.minValue(0.5), v.maxValue(3))),
		ink: v.optional(v.pipe(v.number(), v.minValue(0.05), v.maxValue(0.95)))
	}),
	v.object({
		...base,
		type: v.literal('qr'),
		data: v.pipe(v.string(), v.maxLength(2000)),
		ecc: v.optional(v.picklist(['L', 'M', 'Q', 'H'])),
		module: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64))),
		quiet: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8))),
		stretch: v.optional(v.boolean())
	}),
	v.object({
		...base,
		type: v.literal('line'),
		thickness: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(128)),
		direction: v.optional(v.picklist(['across', 'along'])),
		extent: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)))
	}),
	v.object({ ...base, type: v.literal('space') }),
	v.object({
		...base,
		type: v.literal('bitmap'),
		w: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20000)),
		h: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1024)),
		dpi: v.tuple([v.number(), v.number()]),
		data: v.string()
	})
]);

export const labelSchema = v.object({
	v: v.literal(1),
	media: v.object({ id: v.string(), tape: v.optional(v.string()), text: v.optional(v.string()) }),
	layout: v.optional(v.picklist(['row', 'free'])),
	orientation: v.optional(v.literal('portrait')),
	highRes: v.optional(v.boolean()),
	length: v.optional(mm),
	padding: v.optional(mm),
	gap: v.optional(mm),
	justify: align,
	blocks: v.pipe(v.array(blockSchema), v.maxLength(100))
});

export const varsSchema = v.record(v.string(), v.pipe(v.string(), v.maxLength(2000)));

// Keeps the schema and the Label type from drifting apart.
export type _Check = v.InferOutput<typeof labelSchema> extends Label ? true : never;
const _check: _Check = true;
void _check;
