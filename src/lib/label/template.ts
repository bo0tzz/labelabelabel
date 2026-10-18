import type { Label } from './types.js';

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Replaces `{{name}}` with values; unknown names are left in place. */
export function fillTemplate(text: string, vars: Record<string, string> | undefined): string {
	if (!vars) return text;
	return text.replace(VARIABLE, (match, name: string) => vars[name] ?? match);
}

export function templateVariables(label: Label): string[] {
	const names = new Set<string>();
	for (const block of label.blocks) {
		const text = block.type === 'text' ? block.text : block.type === 'qr' ? block.data : '';
		for (const m of text.matchAll(VARIABLE)) names.add(m[1]);
	}
	return [...names];
}
