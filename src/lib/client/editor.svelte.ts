import { Debounced, StateHistory } from 'runed';
import { DEFAULT_FONT } from '#lib/fonts.js';
import { convertDrawing, emptyDrawing, resizeDrawing } from '#lib/label/drawing.js';
import type { BitmapBlock, Block, BlockType, Label, MediaRef } from '#lib/label/types.js';
import { templateVariables } from '#lib/label/template.js';
import { dotsToMm, mmToDots, type MediaGeometry } from '#lib/media.js';
import type { RenderedLabel } from '#lib/render/render.js';

const DRAFT_KEY = 'labelabelabel:draft';

function newId() {
	return Math.random().toString(36).slice(2, 10);
}

export function newBlock(type: BlockType): Block {
	const id = newId();
	switch (type) {
		case 'text':
			return { id, type, text: 'Text', font: DEFAULT_FONT, tight: true };
		case 'qr':
			return { id, type, data: 'https://' };
		case 'line':
			return { id, type, thickness: 2 };
		case 'space':
			return { id, type, width: 5 };
		case 'bitmap':
			return { id, type, w: 8, h: 8, dpi: [180, 180], data: 'AAAAAAAAAAA=' };
	}
}

export function newLabel(media: MediaRef = { id: 'tze-12' }): Label {
	return { v: 1, media, highRes: true, blocks: [{ ...newBlock('text'), text: '' } as Block] };
}

interface Draft {
	doc: Label;
	labelId?: string;
	name: string;
	vars: Record<string, string>;
	/** What was last saved, to tell whether there are unsaved changes. */
	saved?: string;
}

type Geometry = Pick<Block, 'x' | 'y' | 'width' | 'height'>;

const round = (mm: number) => Math.round(mm * 1000) / 1000;

export class Editor {
	doc = $state<Label>(newLabel());
	labelId = $state<string | undefined>();
	name = $state('');
	vars = $state<Record<string, string>>({});
	selectedId = $state<string | null>(this.doc.blocks[0]?.id ?? null);
	copies = $state(1);
	/** Undefined leaves it to the printer's default for the loaded tape. */
	halfCut = $state<boolean | undefined>();
	chain = $state(false);
	/** True until the user picks a tape or loads a label, so the loaded tape can be applied. */
	pristineMedia = $state(true);
	saved = $state<string | undefined>();
	tool = $state<'select' | 'pen' | 'eraser'>('select');
	/** Pen size in dots. */
	brush = $state(1);
	#dragStart: (Geometry & { drawing?: BitmapBlock }) | null = null;

	selected = $derived(this.doc.blocks.find((b) => b.id === this.selectedId) ?? null);
	variables = $derived(templateVariables(this.doc));
	free = $derived(this.doc.layout === 'free');
	dirty = $derived(this.#snapshot() !== this.saved);

	/** A name for jobs and saving: the given name, else the label's first line of text. */
	displayName = $derived.by(() => {
		if (this.name) return this.name;
		for (const b of this.doc.blocks) {
			if (b.type !== 'text') continue;
			// Private use characters are icons that would show as boxes outside the label.
			const line = b.text
				.replace(/\p{Co}/gu, '')
				.trim()
				.split('\n')[0];
			if (line) return line.slice(0, 60);
		}
		return 'Label';
	});

	#snapshot() {
		return JSON.stringify({ name: this.name, doc: this.doc });
	}

	load(draft: Draft) {
		this.doc = draft.doc;
		this.labelId = draft.labelId;
		this.name = draft.name;
		this.vars = draft.vars;
		this.saved = draft.saved;
		this.selectedId = draft.doc.blocks[0]?.id ?? null;
		this.pristineMedia = false;
		this.#settled.setImmediately(JSON.stringify(draft.doc));
		this.#history.clear();
	}

	// History is kept of the document once edits settle, so a burst like a drag is one step.
	#settled = new Debounced(() => JSON.stringify(this.doc), 400);
	#history = new StateHistory(
		() => this.#settled.current,
		(json) => this.#restore(json),
		{ capacity: 200 }
	);

	get canUndo() {
		return this.#history.canUndo;
	}

	get canRedo() {
		return this.#history.canRedo;
	}

	/** Takes the current state into the history now instead of after the pause. */
	record() {
		return this.#settled.updateImmediately();
	}

	async undo() {
		await this.record();
		this.#history.undo();
	}

	redo() {
		this.#history.redo();
	}

	#restore(json: string) {
		this.doc = JSON.parse(json);
		this.#settled.setImmediately(json);
		if (!this.doc.blocks.some((b) => b.id === this.selectedId)) {
			this.selectedId = this.doc.blocks[0]?.id ?? null;
		}
	}

	/** Marks the current state as saved under `labelId`. */
	markSaved(labelId: string) {
		this.labelId = labelId;
		this.saved = this.#snapshot();
	}

	clear() {
		this.load({ doc: newLabel(this.doc.media), name: '', vars: {} });
		this.pristineMedia = true;
	}

	setMedia(media: MediaRef) {
		this.doc.media = media;
		this.pristineMedia = false;
	}

	add(type: BlockType) {
		const block = newBlock(type);
		if (this.free) {
			const right = Math.max(0, ...this.doc.blocks.map((b) => (b.x ?? 0) + (b.width ?? 0)));
			Object.assign(block, { x: round(right + 2), y: 0 });
		}
		const index = this.doc.blocks.findIndex((b) => b.id === this.selectedId);
		this.doc.blocks.splice(index === -1 ? this.doc.blocks.length : index + 1, 0, block);
		this.selectedId = block.id;
	}

	/** Adds an empty drawing as tall as the tape and picks up the pen. */
	addDrawing(media: MediaGeometry, dpi: { along: number; across: number }) {
		const block = newBlock('bitmap') as BitmapBlock;
		block.w = mmToDots(20, dpi.along);
		block.h = media.dots;
		block.dpi = [dpi.along, dpi.across];
		block.data = emptyDrawing(block.w, block.h);
		if (this.free) {
			const right = Math.max(0, ...this.doc.blocks.map((b) => (b.x ?? 0) + (b.width ?? 0)));
			Object.assign(block, { x: round(right + 2), y: 0 });
		}
		const index = this.doc.blocks.findIndex((b) => b.id === this.selectedId);
		this.doc.blocks.splice(index === -1 ? this.doc.blocks.length : index + 1, 0, block);
		this.selectedId = block.id;
		this.tool = 'pen';
	}

	/** Switches tools; drawing tools need the selected drawing at the label's resolution. */
	setTool(tool: 'select' | 'pen' | 'eraser', dpi: { along: number; across: number }) {
		const block = this.selected;
		if (tool !== 'select' && block?.type === 'bitmap')
			convertDrawing(block, [dpi.along, dpi.across]);
		this.tool = tool;
	}

	/** Stores a finished stroke as its own undo step. */
	setDrawing(id: string, data: string) {
		const block = this.doc.blocks.find((b) => b.id === id);
		if (block?.type !== 'bitmap') return;
		block.data = data;
		void this.record();
	}

	remove(id: string) {
		const index = this.doc.blocks.findIndex((b) => b.id === id);
		if (index === -1) return;
		this.doc.blocks.splice(index, 1);
		if (this.selectedId === id) {
			this.selectedId = this.doc.blocks[Math.max(0, index - 1)]?.id ?? null;
		}
	}

	move(id: string, delta: -1 | 1) {
		const index = this.doc.blocks.findIndex((b) => b.id === id);
		this.reorder(id, index + delta);
	}

	reorder(id: string, target: number) {
		const index = this.doc.blocks.findIndex((b) => b.id === id);
		if (index === -1 || target < 0 || target >= this.doc.blocks.length || target === index) return;
		const [block] = this.doc.blocks.splice(index, 1);
		this.doc.blocks.splice(target, 0, block);
	}

	/**
	 * Switches between row and free layout. Going to free layout pins every block where the row
	 * layout put it, so nothing jumps.
	 */
	setLayout(layout: 'row' | 'free', rendered: RenderedLabel, media: MediaGeometry) {
		if (layout === (this.doc.layout ?? 'row')) return;
		const { along, across } = rendered.dpi;
		if (layout === 'free') {
			const origin = Math.min(...rendered.blocks.map((b) => b.x));
			for (const block of this.doc.blocks) {
				const box = rendered.blocks.find((b) => b.id === block.id);
				if (!box || block.type === 'space') continue;
				block.x = round(dotsToMm(box.x - origin, along));
				block.y = 0;
				if (block.type === 'bitmap') {
					block.y = round(dotsToMm(Math.floor((media.dots - block.h) / 2), across));
					continue;
				}
				block.width = round(dotsToMm(box.width, along));
				block.height = round(dotsToMm(media.dots, across));
			}
			this.doc.blocks = this.doc.blocks.filter((b) => b.type !== 'space');
			this.doc.layout = 'free';
		} else {
			for (const block of this.doc.blocks) {
				delete block.x;
				delete block.y;
				delete block.width;
				delete block.height;
			}
			this.doc.blocks.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
			delete this.doc.layout;
		}
	}

	dragStart(id: string) {
		const block = this.doc.blocks.find((b) => b.id === id);
		this.#dragStart = block
			? {
					x: block.x,
					y: block.y,
					width: block.width,
					height: block.height,
					drawing: block.type === 'bitmap' ? $state.snapshot(block) : undefined
				}
			: null;
	}

	/** Applies a box from the preview, in dots, relative to where the drag started. */
	drag(
		id: string,
		box: { x: number; y: number; width: number; height: number },
		start: { x: number; y: number; width: number; height: number },
		dpi: { along: number; across: number }
	) {
		const block = this.doc.blocks.find((b) => b.id === id);
		const from = this.#dragStart;
		if (!block || !from) return;
		block.x = round(Math.max(0, (from.x ?? 0) + dotsToMm(box.x - start.x, dpi.along)));
		block.y = round((from.y ?? 0) + dotsToMm(box.y - start.y, dpi.across));
		if (block.type === 'bitmap' && from.drawing) {
			// Resizing a drawing changes its canvas; what is drawn stays where it was on the label.
			if (box.width === start.width && box.height === start.height) return;
			const original = { ...from.drawing };
			convertDrawing(original, [dpi.along, dpi.across]);
			resizeDrawing(original, box.width, box.height, start.x - box.x, start.y - box.y);
			Object.assign(block, {
				w: original.w,
				h: original.h,
				dpi: original.dpi,
				data: original.data
			});
			return;
		}
		if (box.width !== start.width) block.width = round(dotsToMm(box.width, dpi.along));
		if (box.height !== start.height) block.height = round(dotsToMm(box.height, dpi.across));
	}

	nudge(dx: number, dy: number, dpi: { along: number; across: number }) {
		const block = this.selected;
		if (!block) return;
		block.x = round(Math.max(0, (block.x ?? 0) + dotsToMm(dx, dpi.along)));
		block.y = round((block.y ?? 0) + dotsToMm(dy, dpi.across));
	}

	saveDraft() {
		try {
			const draft: Draft = {
				doc: $state.snapshot(this.doc),
				labelId: this.labelId,
				name: this.name,
				vars: $state.snapshot(this.vars),
				saved: this.saved
			};
			localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
		} catch {
			// Storage can be unavailable; the draft is a convenience.
		}
	}

	restoreDraft(): boolean {
		try {
			const raw = localStorage.getItem(DRAFT_KEY);
			if (!raw) return false;
			const draft = JSON.parse(raw) as Draft;
			if (draft?.doc?.v !== 1) return false;
			this.load(draft);
			return true;
		} catch {
			return false;
		}
	}
}
