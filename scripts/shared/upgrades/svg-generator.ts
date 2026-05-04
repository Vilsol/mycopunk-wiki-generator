import { type GenericGunUpgrade, type PatternNode, Direction } from './types';
import { convertColor } from './utils';

const DEFAULT_RARITY_COLOR = '#4A90E2';
const HEX_BORDER_COLOR = '#414141';
const HEX_INNER_COLOR = '#16151b';

export const DEFAULT_HEX_OPTIONS = {
	hexSize: 56,
	glowIntensity: 15,
	borderOverlap: 1.0375,
	glow: false,
	borderColor: HEX_BORDER_COLOR,
	backgroundColor: HEX_INNER_COLOR
} as const;

const HORIZONTAL_SPACING_FACTOR = 0.75;
const INNER_HEX_BORDER_OFFSET = 1.5;
const ACTIVE_CELL_SCALE = 0.55;
const CONNECTION_HEIGHT_SCALE = 0.2;
const CONNECTION_END_SCALE = 1.17;

const SQRT_3 = Math.sqrt(3);

const HEX_UNIT_VERTICES: ReadonlyArray<readonly [number, number]> = (() => {
	const verts: Array<[number, number]> = [];
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i;
		verts.push([Math.cos(angle), Math.sin(angle)]);
	}
	return verts;
})();

const ROTATION_ANGLES: Record<Direction, number> = {
	[Direction.None]: 0,
	[Direction.North]: -90,
	[Direction.NorthEast]: -30,
	[Direction.SouthEast]: 30,
	[Direction.South]: 90,
	[Direction.SouthWest]: 150,
	[Direction.NorthWest]: 210
} as Record<Direction, number>;

let svgCounter = 0;

export interface HexGridSVGOptions {
	width: number;
	height: number;
	upgrades: GenericGunUpgrade[];
	hexSize?: number;
	glowIntensity?: number;
	borderOverlap?: number;
	glow?: boolean;
	borderColor?: string;
	backgroundColor?: string;
}

interface HexagonData {
	x: number;
	y: number;
	pos: { x: number; y: number };
}

export function generateHexGridSVG(options: HexGridSVGOptions): string {
	const {
		width,
		height,
		upgrades,
		hexSize = DEFAULT_HEX_OPTIONS.hexSize,
		glowIntensity = DEFAULT_HEX_OPTIONS.glowIntensity,
		borderOverlap = DEFAULT_HEX_OPTIONS.borderOverlap,
		glow = DEFAULT_HEX_OPTIONS.glow,
		borderColor = DEFAULT_HEX_OPTIONS.borderColor,
		backgroundColor = DEFAULT_HEX_OPTIONS.backgroundColor
	} = options;

	const filterId = `glow-${++svgCounter}`;
	const filterAttr = glow ? ` filter="url(#${filterId})"` : '';

	const hexWidth = hexSize * 2;
	const hexHeight = hexSize * SQRT_3;
	const horizontalSpacing = hexWidth * HORIZONTAL_SPACING_FACTOR;
	const verticalSpacing = hexHeight;
	const borderHexSize = hexSize * borderOverlap;

	const remapped = new Map<number, Map<number, PatternNode>>();
	for (const upgrade of upgrades) {
		for (const [y, nodeRow] of upgrade.Pattern.nodes.entries()) {
			if (!remapped.has(y)) {
				remapped.set(y, new Map<number, PatternNode>());
			}
			for (const [x, node] of nodeRow.nodes.entries()) {
				remapped.get(y)!.set(x, node);
			}
		}
	}

	const hexagonData: HexagonData[][] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;

	const hexVerticalRadius = borderHexSize * (SQRT_3 / 2);

	for (let x = 0; x < width; x++) {
		hexagonData[x] = [];
		for (let y = 0; y < height; y++) {
			const posX = x * horizontalSpacing + hexSize;
			const posY = y * verticalSpacing + (x % 2) * (verticalSpacing / 2) + hexSize;

			hexagonData[x][y] = { x, y, pos: { x: posX, y: posY } };

			const hexLeft = posX - borderHexSize;
			const hexRight = posX + borderHexSize;
			const hexTop = posY - hexVerticalRadius;
			const hexBottom = posY + hexVerticalRadius;

			minX = Math.min(minX, hexLeft);
			maxX = Math.max(maxX, hexRight);
			minY = Math.min(minY, hexTop);
			maxY = Math.max(maxY, hexBottom);
		}
	}

	const viewBoxX = minX;
	const viewBoxY = minY;
	const viewBoxWidth = maxX - minX;
	const viewBoxHeight = maxY - minY;

	function getHexagonPoints(cx: number, cy: number, size: number): string {
		const points = [];
		for (let i = 0; i < 6; i++) {
			const [c, s] = HEX_UNIT_VERTICES[i];
			points.push(`${cx + size * c},${cy + size * s}`);
		}
		return points.join(' ');
	}

	const rawColor = upgrades.length > 0 ? convertColor(upgrades[0].Color) : DEFAULT_RARITY_COLOR;
	const rarityColor =
		typeof rawColor === 'string' && /^(#|rgb|hsl)/i.test(rawColor)
			? rawColor
			: DEFAULT_RARITY_COLOR;

	const connectionHeight = hexSize * CONNECTION_HEIGHT_SCALE;
	const connectionStart = hexSize * ACTIVE_CELL_SCALE;
	const connectionEnd = hexSize * CONNECTION_END_SCALE;

	let svgContent = `<svg
		class="hex-grid"
		viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}"
		width="${viewBoxWidth}"
		height="${viewBoxHeight}"
		xmlns="http://www.w3.org/2000/svg"
		style="--rarity-color: ${rarityColor}"
	>`;

	if (glow) {
		svgContent += `
		<defs>
			<filter id="${filterId}" x="-300%" y="-300%" width="500%" height="500%">
				<feGaussianBlur stdDeviation="${glowIntensity}" result="coloredBlur"/>
				<feMerge>
					<feMergeNode in="coloredBlur"/>
					<feMergeNode in="SourceGraphic"/>
				</feMerge>
			</filter>
		</defs>`;
	}

	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			const hexData = hexagonData[x][y];
			const cell = remapped.get(y)?.get(x);
			const pos = hexData.pos;

			svgContent += `
				<polygon
					points="${getHexagonPoints(pos.x, pos.y, borderHexSize)}"
					fill="${borderColor}"
					stroke="none"
				/>`;

			svgContent += `
				<polygon
					points="${getHexagonPoints(pos.x, pos.y, hexSize - INNER_HEX_BORDER_OFFSET)}"
					fill="${backgroundColor}"
					stroke="none"
				/>`;

			if (cell?.enabled) {
				svgContent += `
					<polygon
						points="${getHexagonPoints(pos.x, pos.y, hexSize * ACTIVE_CELL_SCALE)}"
						fill="var(--rarity-color)"${filterAttr}
					/>`;
			}
		}
	}

	const directions = [
		Direction.North,
		Direction.NorthEast,
		Direction.SouthEast,
		Direction.South,
		Direction.SouthWest,
		Direction.NorthWest
	];

	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			const hexData = hexagonData[x][y];
			const cell = remapped.get(y)?.get(x);
			const pos = hexData.pos;

			if (cell?.enabled) {
				for (const direction of directions) {
					if (cell.connections & direction) {
						svgContent += `
							<polygon
								points="${connectionStart},-${connectionHeight} ${connectionEnd},-${connectionHeight} ${connectionEnd},${connectionHeight} ${connectionStart},${connectionHeight}"
								fill="var(--rarity-color)"${filterAttr}
								transform="translate(${pos.x}, ${pos.y}) rotate(${ROTATION_ANGLES[direction]})"
							/>`;
					}
				}
			}
		}
	}

	svgContent += '</svg>';
	return svgContent;
}
