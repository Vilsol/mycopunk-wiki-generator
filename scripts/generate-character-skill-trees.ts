// Render per-character skill-tree SVGs from `(CoordX, CoordY)`. Output to
// `generated-svgs/characters/`. Coordinates here MUST stay in sync with the
// imagemap regions emitted by the character entity formatter into `/source`
// — both call `layoutSkillTree(...)` so they're guaranteed to match.

import fs from 'node:fs';
import path from 'node:path';
import {
	loadCharacters,
	displayFilename,
	layoutSkillTree,
	loadUpgradesByID
} from './shared/entities/characters.ts';
import { ensureDir, entityOutputDir } from './shared/paths.ts';
import type { SkillTreeNode } from './shared/data/schema.d.ts';

async function main() {
	const characters = loadCharacters();
	const upgradesByID = loadUpgradesByID();
	const outputDir = entityOutputDir(import.meta.url, 'characters', 'svgs');
	ensureDir(outputDir);

	console.log(`Processing ${characters.length} characters…`);

	let success = 0;
	let errors = 0;

	for (const c of characters) {
		try {
			const tree = (c as { SkillTree?: SkillTreeNode[] }).SkillTree ?? [];
			if (tree.length === 0) {
				console.warn(`⚠ ${c.Name} has no skill tree, skipping`);
				continue;
			}
			const layout = layoutSkillTree(tree, upgradesByID, c.Name, import.meta.url);
			const filename = `${displayFilename(c)}_SkillTreeV7.svg`;
			fs.writeFileSync(path.join(outputDir, filename), layout.svg, 'utf8');
			console.log(`✓ ${filename} (${layout.width}×${layout.height}, ${layout.nodeCount} nodes)`);
			success++;
		} catch (e) {
			console.error(`✗ Error rendering skill tree for ${c.Name}:`, e);
			errors++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`✓ Generated: ${success}`);
	console.log(`✗ Errors:    ${errors}`);
	console.log(`📁 Output:   ${outputDir}`);

	if (errors > 0) process.exit(1);
}

await main();
