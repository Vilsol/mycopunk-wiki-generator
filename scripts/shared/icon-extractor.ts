// Shared sprite-rect → PNG extractor used by every entity that publishes icons
// (upgrades, gears, status-effects, resources, characters, threats). The
// per-entity scripts collapse to thin wrappers around `extractIcons()`.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ensureDir } from './paths';
import type { DIcon } from './data/schema';

export type SpriteTexture = DIcon;

// Optional color tint, expressed as 0-255 channels. Only upgrades use this —
// they composite a solid-color overlay onto the alpha-extracted sprite to
// produce rarity-coloured silhouettes. Other entities keep the original RGBA.
export interface RGBColor {
	r: number;
	g: number;
	b: number;
}

export interface ExtractIconsOptions<T> {
	// Items to process. Implementations skip items where `getTexture` returns null.
	items: T[];
	// Source sprite directory (already resolved to an absolute path).
	spritesheetsPath: string;
	// Where to write output PNGs. Created if missing.
	outputDir: string;
	// Per-item display label for log lines (e.g. "Slicer (ID: 1)").
	identLabel: (item: T) => string;
	// Texture metadata. Return null/undefined if the item has no icon.
	getTexture: (item: T) => SpriteTexture | null | undefined;
	// File basename (without extension). Result is `${name}_Icon.png` on disk.
	getDisplayName: (item: T) => string;
	// Optional color tint (returns null/undefined to skip tinting). When
	// provided, the sprite is alpha-masked onto a solid-color rect.
	getTintColor?: (item: T) => RGBColor | null | undefined;
	// Banner shown before the loop starts.
	entityLabelPlural: string;
}

export interface ExtractIconsResult {
	success: number;
	errors: number;
	noTexture: number;
	missingSheet: number;
	invalidRect: number;
	tintFailed: number;
	outputDir: string;
}

function rectToTopLeft(
	rect: number[],
	sheetHeight: number
): { left: number; top: number; width: number; height: number } {
	if (rect.length !== 4 || !rect.every((n) => Number.isFinite(n))) {
		throw new Error(`Invalid rect: expected 4 finite numbers, got ${JSON.stringify(rect)}`);
	}
	const left = Math.round(rect[0]);
	const bottom = Math.round(rect[1]);
	const width = Math.round(rect[2]);
	const height = Math.round(rect[3]);
	const top = sheetHeight - bottom - height;
	if (top < 0) {
		throw new Error(
			`Invalid rect: computed top is negative (${top}) for rect=${JSON.stringify(rect)} sheetHeight=${sheetHeight}`
		);
	}
	return { left, top, width, height };
}

export async function extractIcons<T>(opts: ExtractIconsOptions<T>): Promise<ExtractIconsResult> {
	if (!fs.existsSync(opts.spritesheetsPath)) {
		console.error(`Error: spritesheets directory does not exist: ${opts.spritesheetsPath}`);
		process.exit(1);
	}
	ensureDir(opts.outputDir);

	console.log(`Processing ${opts.items.length} ${opts.entityLabelPlural}…`);
	console.log(`Looking for spritesheets in: ${opts.spritesheetsPath}`);

	const cache = new Map<string, { buffer: Buffer; height: number }>();
	const counts: ExtractIconsResult = {
		success: 0,
		errors: 0,
		noTexture: 0,
		missingSheet: 0,
		invalidRect: 0,
		tintFailed: 0,
		outputDir: opts.outputDir
	};

	for (const item of opts.items) {
		const ident = opts.identLabel(item);
		try {
			const tex = opts.getTexture(item);
			if (!tex || !tex.Texture) {
				console.warn(`⚠ ${ident} has no Icon.Texture`);
				counts.noTexture++;
				continue;
			}

			let sheetPath: string | null = null;
			for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
				const candidate = path.join(opts.spritesheetsPath, tex.Texture + ext);
				if (fs.existsSync(candidate)) {
					sheetPath = candidate;
					break;
				}
			}
			if (!sheetPath) {
				console.warn(`⚠ Spritesheet not found for ${ident}: ${tex.Texture}`);
				counts.missingSheet++;
				continue;
			}

			let cached = cache.get(sheetPath);
			if (!cached) {
				const buffer = await fs.promises.readFile(sheetPath);
				const { height } = await sharp(buffer).metadata();
				if (!height) {
					console.warn(`⚠ Could not read height for ${tex.Texture}`);
					continue;
				}
				cached = { buffer, height };
				cache.set(sheetPath, cached);
				console.log(`Loaded spritesheet: ${path.basename(sheetPath)}`);
			}

			if (!tex.Rect) {
				console.warn(`⚠ ${ident} has no Icon.Rect`);
				counts.invalidRect++;
				continue;
			}
			const rect = rectToTopLeft(tex.Rect, cached.height);
			if (rect.width <= 0 || rect.height <= 0) {
				console.warn(`⚠ Invalid rect for ${ident}: width=${rect.width} height=${rect.height}`);
				counts.invalidRect++;
				continue;
			}

			const filename = `${opts.getDisplayName(item)}_Icon.png`;
			const outputPath = path.join(opts.outputDir, filename);

			if (opts.getTintColor) {
				const color = opts.getTintColor(item);
				if (!color) {
					console.warn(`⚠ Could not derive tint color for ${ident}`);
					counts.tintFailed++;
					continue;
				}
				const overlay = Buffer.from(
					`<svg width="${rect.width}" height="${rect.height}"><rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})"/></svg>`
				);
				await sharp(overlay)
					.composite([
						{ input: await sharp(cached.buffer).extract(rect).toBuffer(), blend: 'dest-in' }
					])
					.png()
					.toFile(outputPath);
			} else {
				await sharp(cached.buffer).extract(rect).png().toFile(outputPath);
			}

			console.log(`✓ ${filename} (${rect.width}×${rect.height} from ${tex.Texture})`);
			counts.success++;
		} catch (e) {
			console.error(`✗ Error generating icon for ${ident}:`, e);
			counts.errors++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`✓ Generated:               ${counts.success}`);
	console.log(`⚠ Skipped (no texture):    ${counts.noTexture}`);
	console.log(`⚠ Skipped (sheet missing): ${counts.missingSheet}`);
	console.log(`⚠ Skipped (invalid rect):  ${counts.invalidRect}`);
	if (opts.getTintColor) {
		console.log(`⚠ Skipped (tint failed):   ${counts.tintFailed}`);
	}
	console.log(`✗ Errors:                  ${counts.errors}`);
	console.log(`📁 Output:                 ${counts.outputDir}`);

	return counts;
}

// Convenient main-script harness: parse argv, call extractIcons, exit non-zero
// on errors. Each per-entity script collapses to a single `runIconExtractor`
// call.
export async function runIconExtractor<T>(
	usage: string,
	opts: Omit<ExtractIconsOptions<T>, 'spritesheetsPath'>
): Promise<void> {
	const spritesheetsPath = process.argv[2];
	if (!spritesheetsPath) {
		console.error(`Usage: ${usage}`);
		process.exit(1);
	}
	const result = await extractIcons({ ...opts, spritesheetsPath: path.resolve(spritesheetsPath) });
	if (result.errors > 0) process.exit(1);
}
