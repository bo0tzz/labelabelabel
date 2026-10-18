/** Usual length of a new cassette of this kind, per Brother's product line. */
export function nominalLengthMm(tape: { kind: string; tape?: string | null }): number {
	if (tape.kind === 'hs21' || tape.kind === 'hs31') return 1500;
	if (tape.tape?.startsWith('fluorescent')) return 5000;
	return 8000;
}

export function tapeLengthMm(tape: {
	kind: string;
	tape?: string | null;
	lengthMm?: number | null;
}) {
	return tape.lengthMm ?? nominalLengthMm(tape);
}
