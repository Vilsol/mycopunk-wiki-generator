// Layout for character skill-tree SVGs.
//
// Hex shape: flat-top hexagon (horizontal top/bottom edges).
//
// Coordinates: `(CoordX, CoordY)` are odd-q OFFSET coordinates, with the
// game's Y-up axis flipped to SVG's Y-down. Odd columns shift half a row up.
//
//   px_x = STEP_X · CoordX
//   px_y = -STEP_Y · (CoordY + (CoordX is odd ? 0.5 : 0))
//
// Verified against ground truth on the Glider tree:
//   M.I.R.V        (-1, -7) — bottom-middle of the Y stem
//   Clearing Charge ( 0, -6) — adjacent above-and-left of M.I.R.V
//   Nanite Return  ( 1, -6) — adjacent above-and-right of Clearing Charge
//
// Each hex has a dark fill, a rarity-coloured stroke, and a centred upgrade
// icon (base64-embedded). The SVG itself is transparent — like upgrade
// pattern SVGs, it inherits the host page's background.

import fs from 'node:fs';
import path from 'node:path';
import type { SkillTreeNode } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { stripHtml } from '../wiki-text';
import { displayFilename as upgradeDisplayFilename } from '../load-upgrades';
import { entityOutputDir } from '../paths';

const RARITY_STROKE: Record<string, string> = {
	Standard: '#3dff76',
	Rare: '#58bcff',
	Epic: '#d35fff',
	Exotic: '#ffa02a',
	Oddity: '#ff3134',
	Contraband: '#a050ff'
};

const SQRT_3 = Math.sqrt(3);

// Layout knobs.
const HEX_SIZE = 42; // distance from cell center to outer corner
const HEX_GAP = 2; // visual gap between adjacent cells
const ICON_FRAC = 0.55; // icon size relative to hex inner-circle diameter
const PADDING = 24;
const STROKE_WIDTH = 4;
const HEX_FILL = '#16151b';
const FALLBACK_TEXT = '#cccccc';

// Derived geometry — computed once.
const STEP = HEX_SIZE + HEX_GAP / 2; // half-gap on each side of every cell
const STEP_X = STEP * 1.5; // column-to-column center distance
const STEP_Y = STEP * SQRT_3; // row-to-row center distance (within a column)
const HEX_HALF_HEIGHT = (HEX_SIZE * SQRT_3) / 2; // y-radius of a flat-top hex
const ICON_SIZE = HEX_SIZE * SQRT_3 * ICON_FRAC; // = inner-circle diameter × frac

// Flat-top hex corners as unit offsets, relative to the cell center.
// Order is corner-walk around the hex (no cos/sin at render time).
const HEX_CORNERS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0.5, SQRT_3 / 2],
	[-0.5, SQRT_3 / 2],
	[-1, 0],
	[-0.5, -SQRT_3 / 2],
	[0.5, -SQRT_3 / 2]
];

export interface SkillTreeLayout {
	svg: string;
	width: number;
	height: number;
	nodeCount: number;
}

function nodeToPixel(coordX: number, coordY: number): { x: number; y: number } {
	// Bitwise `& 1` returns 1 for odd ints (positive or negative) in JS.
	const oddShift = (coordX & 1) * 0.5;
	return {
		x: STEP_X * coordX,
		y: -STEP_Y * (coordY + oddShift)
	};
}

function hexCornersAt(cx: number, cy: number): string {
	let out = '';
	for (let i = 0; i < HEX_CORNERS.length; i++) {
		const [dx, dy] = HEX_CORNERS[i];
		out += `${(cx + dx * HEX_SIZE).toFixed(2)},${(cy + dy * HEX_SIZE).toFixed(2)}`;
		if (i < HEX_CORNERS.length - 1) out += ' ';
	}
	return out;
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// Cache base64-encoded icon payloads so each PNG is read at most once per
// generator run (an icon may be reused across characters).
const iconCache = new Map<string, string | null>();

function iconAsDataURI(upgrade: GenericGunUpgrade, iconsDir: string): string | null {
	const filename = `${upgradeDisplayFilename(upgrade)}_Icon.png`;
	const cached = iconCache.get(filename);
	if (cached !== undefined) return cached;

	const filePath = path.join(iconsDir, filename);
	if (!fs.existsSync(filePath)) {
		iconCache.set(filename, null);
		return null;
	}
	const uri = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
	iconCache.set(filename, uri);
	return uri;
}

export function layoutSkillTree(
	nodes: SkillTreeNode[],
	upgradesByID: Map<string, GenericGunUpgrade>,
	characterName: string,
	importMetaUrl: string
): SkillTreeLayout {
	if (nodes.length === 0) {
		return { svg: '', width: 0, height: 0, nodeCount: 0 };
	}

	const iconsDir = entityOutputDir(importMetaUrl, 'upgrades', 'icons');

	// Place each node, tracking center bounds in one pass.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;

	const placed = nodes.map((n) => {
		const { x, y } = nodeToPixel(n.CoordX ?? 0, n.CoordY ?? 0);
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		return { node: n, upgrade: upgradesByID.get(String(n.Upgrade)), x, y };
	});

	// Inflate by hex extent + padding once, instead of per-node.
	const xMargin = HEX_SIZE + PADDING;
	const yMargin = HEX_HALF_HEIGHT + PADDING;
	const width = Math.ceil(maxX - minX + xMargin * 2);
	const height = Math.ceil(maxY - minY + yMargin * 2);
	const offsetX = -minX + xMargin;
	const offsetY = -minY + yMargin;

	const hexes: string[] = [];

	for (const { node, upgrade, x, y } of placed) {
		const cx = x + offsetX;
		const cy = y + offsetY;
		const stroke = upgrade ? (RARITY_STROKE[upgrade.Rarity] ?? '#888') : '#444';

		hexes.push(
			`<polygon points="${hexCornersAt(cx, cy)}" fill="${HEX_FILL}" stroke="${stroke}" stroke-width="${STROKE_WIDTH}" stroke-linejoin="round" />`
		);

		const iconURI = upgrade ? iconAsDataURI(upgrade, iconsDir) : null;
		if (iconURI) {
			hexes.push(
				`<image href="${iconURI}" x="${(cx - ICON_SIZE / 2).toFixed(2)}" y="${(cy - ICON_SIZE / 2).toFixed(2)}" width="${ICON_SIZE.toFixed(2)}" height="${ICON_SIZE.toFixed(2)}" preserveAspectRatio="xMidYMid meet" />`
			);
		} else {
			// Icon not extracted yet — label the node with a short name.
			const name = upgrade ? stripHtml(upgrade.Name) : `?${node.Upgrade}`;
			const label = name.length > 8 ? name.slice(0, 7) + '…' : name;
			hexes.push(
				`<text x="${cx.toFixed(2)}" y="${(cy + 4).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${FALLBACK_TEXT}">${escapeXml(label)}</text>`
			);
		}
	}

	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
		`<title>${escapeXml(`${characterName} skill tree`)}</title>`,
		...hexes,
		`</svg>`
	].join('\n');

	return { svg, width, height, nodeCount: placed.length };
}
