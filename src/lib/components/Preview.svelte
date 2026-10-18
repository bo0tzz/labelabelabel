<script lang="ts">
	import { tapeColor, textColor } from '#lib/colors.js';
	import { mmToDots, type MediaGeometry } from '#lib/media.js';
	import type { BitmapBlock } from '#lib/label/types.js';
	import { decodeBitmapData, encodeBitmapData } from '#lib/label/drawing.js';
	import type { BlockLayout, RenderedLabel } from '#lib/render/render.js';

	/** A block's box in dots: x along the tape, y across it. */
	export type Box = Pick<BlockLayout, 'x' | 'y' | 'width' | 'height'>;

	interface Props {
		rendered: RenderedLabel;
		media: MediaGeometry;
		tape?: string;
		text?: string;
		selectedId?: string | null;
		/** Blocks to mark as having a problem. */
		problemIds?: string[];
		/** Free layout: blocks can be moved and resized. Otherwise dragging reorders them. */
		free?: boolean;
		onselect?: (id: string) => void;
		ondragstart?: (id: string) => void;
		/** Free layout: new box for a block, and the box it had when the drag started. */
		ondrag?: (id: string, box: Box, start: Box) => void;
		/** Row layout: block dropped at a new position in the order. */
		onreorder?: (id: string, index: number) => void;
		/** Arrow keys on the selected block, in dots. */
		onnudge?: (dx: number, dy: number) => void;
		/** Largest CSS pixels per dot. */
		maxScale?: number;
		/** Tape height in CSS pixels the zoom should stay under. */
		maxHeight?: number;
		/** Fixed CSS pixels per dot, e.g. for thumbnails. */
		fixedScale?: number;
		/** Draw on this drawing instead of selecting and moving blocks. */
		draw?: { block: BitmapBlock; erase: boolean; brush: number } | null;
		/** A finished stroke: the drawing's new data. */
		ondraw?: (id: string, data: string) => void;
		/** Show the tape running down the page, turned 90° clockwise. */
		portrait?: boolean;
	}

	let {
		rendered,
		media,
		tape,
		text,
		selectedId = null,
		problemIds = [],
		free = false,
		onselect,
		ondragstart,
		ondrag,
		onreorder,
		onnudge,
		maxScale = 4,
		maxHeight = 220,
		fixedScale,
		draw = null,
		ondraw,
		portrait = false
	}: Props = $props();

	const MAX_PORTRAIT_HEIGHT = 640;

	let canvas: HTMLCanvasElement | undefined = $state();
	let frame: HTMLDivElement | undefined = $state();
	let tapeElement: HTMLDivElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();
	let containerWidth = $state(0);

	const k = $derived(rendered.dpi.along / rendered.dpi.across);
	const tapeDots = $derived(mmToDots(media.widthMm, media.dpi));
	const top = $derived(Math.floor((tapeDots - media.dots) / 2));
	const feed = $derived(mmToDots(media.feedMm, rendered.dpi.along));
	const length = $derived(
		Math.max(rendered.bitmap.width + feed * 2, mmToDots(rendered.tapeMm, rendered.dpi.along))
	);
	// Whole CSS pixels per dot keep the dot grid even.
	const scale = $derived(
		fixedScale ??
			Math.max(
				1,
				portrait
					? Math.min(
							maxScale,
							Math.floor(containerWidth / tapeDots),
							Math.floor(MAX_PORTRAIT_HEIGHT / (length / k))
						)
					: Math.min(
							maxScale,
							Math.floor(maxHeight / tapeDots),
							Math.floor(containerWidth / (length / k))
						)
			)
	);
	const lengthCss = $derived((length / k) * scale);
	const tapeCss = $derived(tapeDots * scale);
	const interactive = $derived(!!onselect);
	const boxes = $derived(rendered.blocks.filter((b) => b.width > 0 && b.height > 0));

	function rgb(hex: string) {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	$effect(() => {
		if (!canvas) return;
		const { bitmap } = rendered;
		canvas.width = length;
		canvas.height = tapeDots;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const image = ctx.createImageData(length, tapeDots);
		const [br, bg, bb] = rgb(tapeColor(tape));
		const [ir, ig, ib] = rgb(textColor(text));
		const px = image.data;
		for (let i = 0; i < px.length; i += 4) {
			px[i] = br;
			px[i + 1] = bg;
			px[i + 2] = bb;
			px[i + 3] = 255;
		}
		for (let y = 0; y < bitmap.height; y++) {
			for (let x = 0; x < bitmap.width; x++) {
				if (!bitmap.data[y * bitmap.width + x]) continue;
				const i = ((top + y) * length + feed + x) * 4;
				px[i] = ir;
				px[i + 1] = ig;
				px[i + 2] = ib;
			}
		}
		ctx.putImageData(image, 0, 0);
	});

	const cssX = (dots: number) => (dots / k) * scale;
	const cssY = (dots: number) => dots * scale;

	type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

	let drag: {
		id: string;
		handle: Handle;
		pointerX: number;
		pointerY: number;
		start: Box;
		moved: boolean;
	} | null = null;
	let preview = $state<{ id: string; box: Box } | null>(null);
	let guides = $state<{ x: number[]; y: number[] }>({ x: [], y: [] });

	/** Finds the closest line within `threshold` of any of the moving edges. */
	function snap(edges: number[], lines: number[], threshold: number) {
		let best: { shift: number; line: number } | null = null;
		for (const edge of edges) {
			for (const line of lines) {
				const shift = line - edge;
				if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) {
					best = { shift, line };
				}
			}
		}
		return best;
	}

	function linesFor(id: string) {
		const x = [0, rendered.bitmap.width, Math.round(rendered.bitmap.width / 2)];
		const y = [0, media.dots, Math.round(media.dots / 2)];
		for (const b of boxes) {
			if (b.id === id) continue;
			x.push(b.x, b.x + b.width, Math.round(b.x + b.width / 2));
			y.push(b.y, b.y + b.height, Math.round(b.y + b.height / 2));
		}
		return { x, y };
	}

	/** Keeps a box on the printable area: not before the start, not off either edge of the tape. */
	function clampToTape(box: Box): Box {
		const height = Math.min(box.height, media.dots);
		return {
			x: Math.max(0, box.x),
			y: Math.min(Math.max(0, box.y), media.dots - height),
			width: box.width,
			height
		};
	}

	function pointerdown(event: PointerEvent, id: string, handle: Handle) {
		if (!interactive || event.button !== 0) return;
		event.stopPropagation();
		// Prevents text selection while dragging, which also stops the click from taking focus.
		event.preventDefault();
		tapeElement?.focus({ preventScroll: true });
		const layout = boxes.find((b) => b.id === id);
		if (!layout) return;
		onselect?.(id);
		drag = {
			id,
			handle,
			pointerX: event.clientX,
			pointerY: event.clientY,
			start: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function pointermove(event: PointerEvent) {
		if (!drag) return;
		const [dxCss, dyCss] = deltaToLocal(
			event.clientX - drag.pointerX,
			event.clientY - drag.pointerY
		);
		if (!drag.moved) {
			if (Math.hypot(dxCss, dyCss) < 4) return;
			drag.moved = true;
			ondragstart?.(drag.id);
		}
		const dx = Math.round((dxCss / scale) * k);
		const dy = Math.round(dyCss / scale);
		const s = drag.start;

		if (!free) {
			preview = { id: drag.id, box: { ...s, x: s.x + dx } };
			return;
		}

		const lines = linesFor(drag.id);
		const tx = (6 / scale) * k;
		const ty = 6 / scale;
		const gx: number[] = [];
		const gy: number[] = [];
		let box: Box;
		if (drag.handle === 'move') {
			box = { ...s, x: s.x + dx, y: s.y + dy };
			const sx = snap([box.x, box.x + box.width / 2, box.x + box.width], lines.x, tx);
			const sy = snap([box.y, box.y + box.height / 2, box.y + box.height], lines.y, ty);
			if (sx) {
				box.x += Math.round(sx.shift);
				gx.push(sx.line);
			}
			if (sy) {
				box.y += Math.round(sy.shift);
				gy.push(sy.line);
			}
		} else {
			const west = drag.handle.includes('w');
			const north = drag.handle.includes('n');
			let left = s.x + (west ? dx : 0);
			let right = s.x + s.width + (west ? 0 : dx);
			let upper = s.y + (north ? dy : 0);
			let lower = s.y + s.height + (north ? 0 : dy);
			const sx = snap([west ? left : right], lines.x, tx);
			const sy = snap([north ? upper : lower], lines.y, ty);
			if (sx) {
				if (west) left += Math.round(sx.shift);
				else right += Math.round(sx.shift);
				gx.push(sx.line);
			}
			if (sy) {
				if (north) upper += Math.round(sy.shift);
				else lower += Math.round(sy.shift);
				gy.push(sy.line);
			}
			box = {
				x: Math.min(left, right - k),
				y: Math.min(upper, lower - 1),
				width: Math.max(k, right - left),
				height: Math.max(1, lower - upper)
			};
		}
		box = clampToTape(box);
		guides = { x: gx, y: gy };
		preview = { id: drag.id, box };
		ondrag?.(drag.id, box, s);
	}

	function pointerup() {
		if (drag?.moved && !free && preview && onreorder) {
			const id = drag.id;
			const center = preview.box.x + preview.box.width / 2;
			const order = rendered.blocks.map((b) => b.id).filter((b) => b !== id);
			const after = boxes.filter((b) => b.id !== id && b.x + b.width / 2 < center).at(-1);
			onreorder(id, after ? order.indexOf(after.id) + 1 : 0);
		}
		drag = null;
		preview = null;
		guides = { x: [], y: [] };
	}

	// Once a pen has been used, fingers scroll instead of drawing so a resting palm leaves no marks.
	let penSeen = $state(false);
	let stroke: {
		id: string;
		pointerId: number;
		image: ReturnType<typeof decodeBitmapData>;
		left: number;
		top: number;
		last: [number, number];
		ctx: CanvasRenderingContext2D;
	} | null = null;

	/** Screen position to CSS pixels in the (possibly turned) tape element. */
	function toLocal(clientX: number, clientY: number): [number, number] {
		const rect = frame!.getBoundingClientRect();
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		return portrait ? [sy, tapeCss - sx] : [sx, sy];
	}

	/** A movement on screen as a movement in the tape element. */
	function deltaToLocal(dx: number, dy: number): [number, number] {
		return portrait ? [dy, -dx] : [dx, dy];
	}

	function drawingPoint(event: PointerEvent, left: number, imageTop: number): [number, number] {
		const [lx, ly] = toLocal(event.clientX, event.clientY);
		return [(lx / scale) * k - feed - left, ly / scale - top - imageTop];
	}

	function stamp([cx, cy]: [number, number]) {
		if (!stroke || !draw) return;
		const { image, ctx } = stroke;
		const across = Math.max(1, draw.brush);
		const along = Math.max(1, Math.round(draw.brush * k));
		const x0 = Math.floor(cx) - Math.floor((along - 1) / 2);
		const y0 = Math.floor(cy) - Math.floor((across - 1) / 2);
		const value = draw.erase ? 0 : 1;
		ctx.fillStyle = draw.erase ? tapeColor(tape) : textColor(text);
		for (let py = y0; py < y0 + across; py++) {
			for (let px = x0; px < x0 + along; px++) {
				if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
				if (draw.brush >= 3) {
					const dx = (px + 0.5 - cx) / (along / 2);
					const dy = (py + 0.5 - cy) / (across / 2);
					if (dx * dx + dy * dy > 1) continue;
				}
				image.data[py * image.width + px] = value;
				ctx.fillRect(feed + stroke.left + px, top + stroke.top + py, 1, 1);
			}
		}
	}

	function lineTo(point: [number, number]) {
		if (!stroke) return;
		const [x0, y0] = stroke.last;
		const steps = Math.max(
			1,
			Math.ceil(Math.max(Math.abs(point[0] - x0), Math.abs(point[1] - y0)))
		);
		for (let i = 1; i <= steps; i++) {
			stamp([x0 + ((point[0] - x0) * i) / steps, y0 + ((point[1] - y0) * i) / steps]);
		}
		stroke.last = point;
	}

	let pan: { pointerId: number; x: number; y: number } | null = null;

	/** Safari starts selection and scroll gestures from touch events, so those are cancelled. */
	function captureTouch(node: HTMLElement) {
		const cancel = (event: TouchEvent) => event.preventDefault();
		node.addEventListener('touchstart', cancel, { passive: false });
		return () => node.removeEventListener('touchstart', cancel);
	}

	function drawDown(event: PointerEvent) {
		if (!draw || !canvas) return;
		if (event.pointerType === 'pen') penSeen = true;
		else if (event.pointerType === 'touch' && penSeen) {
			pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			return;
		}
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const layout = boxes.find((b) => b.id === draw!.block.id);
		const ctx = canvas.getContext('2d');
		if (!layout || !ctx) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		const { block } = draw;
		const free = layout.height - block.h;
		const imageTop =
			layout.y +
			(block.align === 'start' ? 0 : block.align === 'end' ? free : Math.floor(free / 2));
		const point = drawingPoint(event, layout.x, imageTop);
		stroke = {
			id: block.id,
			pointerId: event.pointerId,
			image: decodeBitmapData(block.data, block.w, block.h),
			left: layout.x,
			top: imageTop,
			last: point,
			ctx
		};
		stamp(point);
	}

	function drawMove(event: PointerEvent) {
		if (pan && event.pointerId === pan.pointerId) {
			container?.scrollBy(pan.x - event.clientX, 0);
			window.scrollBy(0, pan.y - event.clientY);
			pan.x = event.clientX;
			pan.y = event.clientY;
			return;
		}
		if (!stroke || event.pointerId !== stroke.pointerId) return;
		const events = event.getCoalescedEvents?.() ?? [event];
		for (const e of events.length ? events : [event]) {
			lineTo(drawingPoint(e, stroke.left, stroke.top));
		}
	}

	function drawUp(event: PointerEvent) {
		if (pan?.pointerId === event.pointerId) pan = null;
		if (!stroke || event.pointerId !== stroke.pointerId) return;
		const { id, image } = stroke;
		stroke = null;
		ondraw?.(id, encodeBitmapData(image));
	}

	function keydown(event: KeyboardEvent) {
		if (!onnudge || !selectedId) return;
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = portrait
			? {
					ArrowLeft: [0, step],
					ArrowRight: [0, -step],
					ArrowUp: [-step * k, 0],
					ArrowDown: [step * k, 0]
				}
			: {
					ArrowLeft: [-step * k, 0],
					ArrowRight: [step * k, 0],
					ArrowUp: [0, -step],
					ArrowDown: [0, step]
				};
		const move = moves[event.key];
		const layout = boxes.find((b) => b.id === selectedId);
		if (!move || !layout) return;
		event.preventDefault();
		const moved = clampToTape({ ...layout, x: layout.x + move[0], y: layout.y + move[1] });
		onnudge(moved.x - layout.x, moved.y - layout.y);
	}
</script>

<div class="preview" bind:this={container} bind:clientWidth={containerWidth}>
	<div
		class="frame"
		bind:this={frame}
		style:width="{portrait ? tapeCss : lengthCss}px"
		style:height="{portrait ? lengthCss : tapeCss}px"
	>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			bind:this={tapeElement}
			class="tape"
			class:interactive
			class:portrait
			style:left={portrait ? `${tapeCss}px` : undefined}
			style:width="{lengthCss}px"
			style:height="{tapeCss}px"
			tabindex={interactive ? 0 : undefined}
			role={interactive ? 'application' : undefined}
			aria-label={interactive ? 'Label preview' : undefined}
			onkeydown={keydown}
		>
			<canvas bind:this={canvas}></canvas>
			{#if draw}
				<!-- Only the drawing takes touches, so the rest of the preview scrolls as usual. -->
				{#each boxes.filter((b) => b.id === draw.block.id) as layout (layout.id)}
					<div
						class="box selected surface"
						style:left="{cssX(feed + layout.x)}px"
						style:width="{cssX(layout.width)}px"
						style:top="{cssY(top + layout.y)}px"
						style:height="{cssY(layout.height)}px"
						{@attach captureTouch}
						onpointerdown={drawDown}
						onpointermove={drawMove}
						onpointerup={drawUp}
						onpointercancel={drawUp}
						role="presentation"
					></div>
				{/each}
			{:else if interactive}
				{#each boxes as layout (layout.id)}
					{@const shown = !free && preview?.id === layout.id ? preview.box : layout}
					<div
						class="box"
						class:selected={layout.id === selectedId}
						class:problem={problemIds.includes(layout.id)}
						class:free
						class:dragging={!free && preview?.id === layout.id}
						style:left="{cssX(feed + shown.x)}px"
						style:width="{cssX(shown.width)}px"
						style:top="{cssY(top + shown.y)}px"
						style:height="{cssY(shown.height)}px"
						onpointerdown={(e) => pointerdown(e, layout.id, 'move')}
						onpointermove={pointermove}
						onpointerup={pointerup}
						onpointercancel={pointerup}
						role="presentation"
					>
						{#if free && layout.id === selectedId}
							{#each ['nw', 'ne', 'sw', 'se'] as const as handle (handle)}
								<span
									class="handle {handle}"
									onpointerdown={(e) => pointerdown(e, layout.id, handle)}
									onpointermove={pointermove}
									onpointerup={pointerup}
									onpointercancel={pointerup}
									role="presentation"
								></span>
							{/each}
						{/if}
					</div>
				{/each}
				{#each guides.x as x (x)}
					<div class="guide vertical" style:left="{cssX(feed + x)}px"></div>
				{/each}
				{#each guides.y as y (y)}
					<div class="guide horizontal" style:top="{cssY(top + y)}px"></div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.preview {
		overflow-x: auto;
		padding: 8px 8px 8px 0;
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
	.frame {
		position: relative;
	}
	.tape {
		position: relative;
		box-shadow: 0 0 0 1px var(--border);
		outline: none;
	}
	.tape.portrait {
		position: absolute;
		top: 0;
		transform-origin: 0 0;
		transform: rotate(90deg);
	}
	.tape.interactive:focus-visible {
		box-shadow: 0 0 0 2px var(--accent);
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	.box {
		position: absolute;
		cursor: pointer;
	}
	.box:hover,
	.box.selected {
		outline: 1px dashed var(--accent);
	}
	.box.problem {
		outline: 1px solid var(--warn);
	}
	.box.free {
		cursor: move;
		touch-action: none;
	}
	.box.dragging {
		opacity: 0.6;
		outline: 1px solid var(--accent);
	}
	.handle {
		position: absolute;
		width: 10px;
		height: 10px;
		background: var(--panel);
		border: 1px solid var(--accent);
		touch-action: none;
	}
	@media (pointer: coarse) {
		.handle {
			width: 18px;
			height: 18px;
		}
	}
	.handle.nw {
		left: 0;
		top: 0;
		transform: translate(-50%, -50%);
		cursor: nwse-resize;
	}
	.handle.ne {
		right: 0;
		top: 0;
		transform: translate(50%, -50%);
		cursor: nesw-resize;
	}
	.handle.sw {
		left: 0;
		bottom: 0;
		transform: translate(-50%, 50%);
		cursor: nesw-resize;
	}
	.handle.se {
		right: 0;
		bottom: 0;
		transform: translate(50%, 50%);
		cursor: nwse-resize;
	}
	.surface {
		cursor: crosshair;
		touch-action: none;
	}
	.guide {
		position: absolute;
		pointer-events: none;
		background: var(--accent);
		opacity: 0.7;
	}
	.guide.vertical {
		top: 0;
		bottom: 0;
		width: 1px;
	}
	.guide.horizontal {
		left: 0;
		right: 0;
		height: 1px;
	}
</style>
