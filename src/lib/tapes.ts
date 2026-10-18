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

const KIND_NAMES: Record<string, string> = {
	hs21: 'heat shrink 2:1',
	hs31: 'heat shrink 3:1'
};

export function kindName(kind: string) {
	return KIND_NAMES[kind] ?? kind;
}
