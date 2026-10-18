/**
 * A label document. Lengths are in mm unless noted; things that only make sense on the dot
 * grid (line thickness, QR modules, bitmaps) are in dots.
 *
 * In `row` layout the blocks are laid out one after another along the tape, each as tall as
 * the tape. In `free` layout every block has its own box at a position on the label.
 */
export interface Label {
	v: 1;
	media: MediaRef;
	layout?: 'row' | 'free';
	/** Portrait: designed upright with the tape running down, so text runs across the tape. */
	orientation?: 'portrait';
	/** 180×360 dpi mode: twice the resolution along the tape. */
	highRes?: boolean;
	/** Length of the cut piece; omitted for automatic. */
	length?: number;
	/** Blank space at the ends of the content, on top of the printer's feed. */
	padding?: number;
	/** Row layout: space between blocks. */
	gap?: number;
	/** Placement of the content when a fixed length is longer than it. */
	justify?: Align;
	blocks: Block[];
}

export type Align = 'start' | 'center' | 'end';

export interface MediaRef {
	/** Geometry id from the media catalog, e.g. `tze-12`. */
	id: string;
	/** Preferred colours; omitted means any. */
	tape?: string;
	text?: string;
}

interface BlockBase {
	id: string;
	/** Box width; omitted to size to the content. Text shrinks to fit a set width. */
	width?: number;
	/** Free layout: box height; omitted for the height of the tape. */
	height?: number;
	/** Free layout: position of the box from the top left of the printable area. */
	x?: number;
	y?: number;
	/** Placement across the tape (row) or within the box (free) when the content is shorter. */
	align?: Align;
}

export interface TextBlock extends BlockBase {
	type: 'text';
	/** Lines separated by `\n`. `{{name}}` is replaced by template variables. */
	text: string;
	font: string;
	/** Font size in pt; omitted to fit the box. */
	size?: number;
	/** Fit and center on the letters' ink instead of the font's line height. */
	tight?: boolean;
	/** Variable font weight axis. */
	weight?: number;
	/** Filled instead of outlined, for fonts with a fill axis. */
	filled?: boolean;
	textAlign?: Align;
	/** Clockwise, relative to the view (which is turned in portrait). */
	rotate?: 0 | 90 | 180 | 270;
	/** Letters upright one under the other; omitted to stack in portrait only. */
	stack?: boolean;
	lineHeight?: number;
	/** Share of a pixel that must be covered to get ink; lower prints darker. */
	ink?: number;
}

export interface QrBlock extends BlockBase {
	type: 'qr';
	data: string;
	ecc?: 'L' | 'M' | 'Q' | 'H';
	/** Dots per module; omitted for the largest that fits. */
	module?: number;
	/** Quiet zone along the tape in modules. Across the tape the unprinted edge serves. */
	quiet?: number;
	/** Fill the space with modules of uneven whole-dot sizes instead of equal ones. */
	stretch?: boolean;
}

export interface LineBlock extends BlockBase {
	type: 'line';
	/** Thickness in dots at 180 dpi. */
	thickness: number;
	/** `across` runs across the tape (a divider), `along` runs along it (an underline). */
	direction?: 'across' | 'along';
	/** Row layout, across: share of the tape height covered, 0–1. */
	extent?: number;
}

export interface SpaceBlock extends BlockBase {
	type: 'space';
}

export interface BitmapBlock extends BlockBase {
	type: 'bitmap';
	/** Size in pixels along and across the tape. */
	w: number;
	h: number;
	/** Resolution the bitmap was drawn at, along and across the tape. */
	dpi: [number, number];
	/** Base64 of rows packed MSB first, each row padded to whole bytes. */
	data: string;
}

export type Block = TextBlock | QrBlock | LineBlock | SpaceBlock | BitmapBlock;
export type BlockType = Block['type'];
