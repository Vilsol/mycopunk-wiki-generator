import fs from 'node:fs';
import path from 'node:path';
import { generateHexGridSVG, DEFAULT_HEX_OPTIONS } from './shared/upgrades/svg-generator.ts';
import { loadUpgrades, displayFilename } from './shared/load-upgrades.ts';
import { ensureDir, entityOutputDir } from './shared/paths.ts';

async function generateUpgradeSVGs() {
	const upgradesData = loadUpgrades();

	const outputDir = entityOutputDir(import.meta.url, 'upgrades', 'svgs');
	ensureDir(outputDir);

	console.log(`Processing ${upgradesData.length} upgrades...`);

	let errorCount = 0;

	for (const upgrade of upgradesData) {
		try {
			const svgContent = generateHexGridSVG({
				width: upgrade.Pattern.width,
				height: upgrade.Pattern.height,
				upgrades: [upgrade],
				...DEFAULT_HEX_OPTIONS
			});

			const filename = `${displayFilename(upgrade)}_Pattern.svg`;
			const filepath = path.join(outputDir, filename);

			fs.writeFileSync(filepath, svgContent, 'utf8');
			console.log(`Generated: ${filename}`);
		} catch (error) {
			console.error(`Error generating SVG for upgrade ${upgrade.ID}:`, error);
			errorCount++;
		}
	}

	console.log(`\nGeneration complete! SVGs saved to: ${outputDir}`);

	if (errorCount > 0) {
		process.exit(1);
	}
}

await generateUpgradeSVGs();
