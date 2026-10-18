import type { Bitmap } from '#lib/bitmap.js';

/** A closed polygon as flat [x0, y0, x1, y1, ...] in pixel coordinates, y down. */
export type Contour = number[];

export interface Transform {
	scaleX: number;
	scaleY: number;
	translateX: number;
	translateY: number;
}

/** Collects path segments, applying a transform and flattening curves into contours. */
export class PathFlattener {
	contours: Contour[] = [];
	#current: Contour | null = null;
	#x = 0;
	#y = 0;

	constructor(
		public transform: Transform,
		private tolerance = 0.05
	) {}

	#map(x: number, y: number): [number, number] {
		const t = this.transform;
		return [x * t.scaleX + t.translateX, y * t.scaleY + t.translateY];
	}

	moveTo(x: number, y: number) {
		this.close();
		[this.#x, this.#y] = this.#map(x, y);
		this.#current = [this.#x, this.#y];
	}

	lineTo(x: number, y: number) {
		[this.#x, this.#y] = this.#map(x, y);
		this.#current?.push(this.#x, this.#y);
	}

	quadTo(cx: number, cy: number, x: number, y: number) {
		const [x0, y0] = [this.#x, this.#y];
		const [x1, y1] = this.#map(cx, cy);
		const [x2, y2] = this.#map(x, y);
		const n = this.#steps(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2));
		for (let i = 1; i <= n; i++) {
			const t = i / n;
			const u = 1 - t;
			this.#current?.push(
				u * u * x0 + 2 * u * t * x1 + t * t * x2,
				u * u * y0 + 2 * u * t * y1 + t * t * y2
			);
		}
		[this.#x, this.#y] = [x2, y2];
	}

	cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
		const [x0, y0] = [this.#x, this.#y];
		const [x1, y1] = this.#map(c1x, c1y);
		const [x2, y2] = this.#map(c2x, c2y);
		const [x3, y3] = this.#map(x, y);
		const dd = Math.max(
			Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2),
			Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3)
		);
		const n = this.#steps(dd * 1.5);
		for (let i = 1; i <= n; i++) {
			const t = i / n;
			const u = 1 - t;
			this.#current?.push(
				u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
				u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
			);
		}
		[this.#x, this.#y] = [x3, y3];
	}

	close() {
		if (this.#current && this.#current.length >= 6) this.contours.push(this.#current);
		this.#current = null;
	}

	/** Segment count so the chord deviates at most `tolerance` px from the curve. */
	#steps(secondDifference: number) {
		return Math.max(1, Math.min(64, Math.ceil(Math.sqrt(secondDifference / (8 * this.tolerance)))));
	}
}

export interface FillOptions {
	/** Samples per pixel along each axis. */
	samples?: number;
	/** Fraction of a pixel's samples that must be inside for it to get ink. */
	threshold?: number;
}

/** Fills contours with the nonzero rule and ORs the result into the bitmap. */
export function fillContours(target: Bitmap, contours: Contour[], options: FillOptions = {}) {
	const samples = options.samples ?? 4;
	const need = Math.max(1, Math.round((options.threshold ?? 0.5) * samples * samples));
	const { width, height } = target;

	type Edge = { x0: number; y0: number; x1: number; y1: number; dir: number };
	const edges: Edge[] = [];
	let minY = Infinity;
	let maxY = -Infinity;
	for (const c of contours) {
		const n = c.length / 2;
		for (let i = 0; i < n; i++) {
			const ax = c[i * 2];
			const ay = c[i * 2 + 1];
			const bx = c[((i + 1) % n) * 2];
			const by = c[((i + 1) % n) * 2 + 1];
			if (ay === by) continue;
			const e =
				ay < by
					? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 }
					: { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 };
			edges.push(e);
			minY = Math.min(minY, e.y0);
			maxY = Math.max(maxY, e.y1);
		}
	}
	if (!edges.length) return;
	edges.sort((a, b) => a.y0 - b.y0);

	const rowStart = Math.max(0, Math.floor(minY));
	const rowEnd = Math.min(height, Math.ceil(maxY));
	const coverage = new Uint16Array(width);
	const hits: { x: number; dir: number }[] = [];
	let active: Edge[] = [];
	let next = 0;

	for (let py = rowStart; py < rowEnd; py++) {
		coverage.fill(0);
		while (next < edges.length && edges[next].y0 < py + 1) active.push(edges[next++]);
		active = active.filter((e) => e.y1 > py);

		for (let s = 0; s < samples; s++) {
			const yc = py + (s + 0.5) / samples;
			hits.length = 0;
			for (const e of active) {
				if (e.y0 <= yc && yc < e.y1) {
					hits.push({ x: e.x0 + ((yc - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), dir: e.dir });
				}
			}
			if (hits.length < 2) continue;
			hits.sort((a, b) => a.x - b.x);
			let winding = 0;
			let start = 0;
			for (const h of hits) {
				const was = winding;
				winding += h.dir;
				if (was === 0 && winding !== 0) start = h.x;
				else if (was !== 0 && winding === 0) {
					const first = Math.max(0, Math.ceil(start * samples - 0.5));
					const last = Math.min(width * samples, Math.ceil(h.x * samples - 0.5));
					for (let sx = first; sx < last; sx++) coverage[(sx / samples) | 0]++;
				}
			}
		}

		const row = py * width;
		for (let x = 0; x < width; x++) {
			if (coverage[x] >= need) target.data[row + x] = 1;
		}
	}
}
