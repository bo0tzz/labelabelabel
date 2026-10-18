const TAPE: Record<string, string> = {
	white: '#ffffff',
	clear: '#e8eef0',
	red: '#d23a32',
	blue: '#2f62c9',
	yellow: '#f4d21f',
	green: '#3a9a52',
	black: '#1b1b1b',
	'matte white': '#f4f4f0',
	'matte clear': '#e4e8e8',
	'matte silver': '#b9bcbf',
	'satin gold': '#c9a54a',
	'satin silver': '#c4c6c8',
	'fluorescent orange': '#ff7a2f',
	'fluorescent yellow': '#e9ff3a',
	'berry pink': '#d0487c',
	'light gray': '#c8c8c8',
	'lime green': '#9ed14b',
	pink: '#f29bbf',
	other: '#d8d0c0'
};

const TEXT: Record<string, string> = {
	black: '#111111',
	white: '#ffffff',
	red: '#c8221a',
	blue: '#1f4fb5',
	gold: '#b8902c',
	other: '#555555'
};

export function tapeColor(name: string | undefined) {
	return (name && TAPE[name]) || TAPE.white;
}

export function textColor(name: string | undefined) {
	return (name && TEXT[name]) || TEXT.black;
}

export function tapeLabel(tape: { tape?: string | null; text?: string | null }) {
	if (!tape.tape && !tape.text) return 'any colour';
	return `${tape.text ?? 'any'} on ${tape.tape ?? 'any'}`;
}
