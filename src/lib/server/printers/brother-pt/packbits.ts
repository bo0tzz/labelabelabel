export function packbits(input: Uint8Array): Uint8Array {
	const out: number[] = [];
	let i = 0;
	while (i < input.length) {
		let run = 1;
		while (i + run < input.length && run < 128 && input[i + run] === input[i]) run++;
		if (run >= 2) {
			out.push((1 - run) & 0xff, input[i]);
			i += run;
			continue;
		}
		const start = i;
		while (i < input.length && i - start < 128) {
			if (i + 1 < input.length && input[i] === input[i + 1]) break;
			i++;
		}
		out.push(i - start - 1, ...input.subarray(start, i));
	}
	return Uint8Array.from(out);
}
