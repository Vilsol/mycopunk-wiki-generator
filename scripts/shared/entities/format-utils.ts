// Shared formatting helpers used across entity context builders.

import { parseRGBA } from '../upgrades/utils';

// Format a number for display in a wiki table cell. Integers render bare;
// fractions are rounded to `digits` and stripped of trailing zeros.
// Returns '' for undefined / non-finite inputs.
export function fmtNum(n: number | undefined, digits = 2): string {
	if (n === undefined || !Number.isFinite(n)) return '';
	if (Number.isInteger(n)) return String(n);
	return Number(n.toFixed(digits)).toString();
}

// Format a 0..1 ratio as a percentage string (e.g. 0.35 → "35%"). Returns ''
// for undefined / non-finite inputs.
export function fmtPct(n: number | undefined): string {
	if (n === undefined || !Number.isFinite(n)) return '';
	return `${Number((n * 100).toFixed(1)).toString()}%`;
}

// Convert Unity "RGBA(r, g, b, a)" string to a `#rrggbb` hex (alpha ignored).
// When `skipWhiteBlack` is true, returns '' for pure white/black — used by
// resources where #ffffff means "no theme color set" and shouldn't paint a
// title invisible on a light background.
export function rgbaToHex(s: string | undefined, skipWhiteBlack = false): string {
	if (!s) return '';
	const c = parseRGBA(s);
	if (!c) return '';
	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	const h = (n: number) => clamp(n).toString(16).padStart(2, '0');
	const hex = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
	if (skipWhiteBlack && (hex === '#ffffff' || hex === '#000000')) return '';
	return hex;
}
