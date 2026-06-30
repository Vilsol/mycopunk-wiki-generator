// Print the cross-entity (resolved) and within-entity (report-only) page-title
// collision map. Run: `mise run report:collisions`.
import { prepareTitleResolution } from './shared/title-resolver.ts';

async function main() {
	const report = await prepareTitleResolution();
	const cross = report.groups.filter((g) => g.kind === 'cross-entity');
	const within = report.groups.filter((g) => g.kind === 'within-entity');

	console.log(
		`Collisions — cross-entity (resolved): ${report.crossEntityCount}; within-entity (report-only): ${report.withinEntityCount}\n`
	);

	if (cross.length) {
		console.log('=== Cross-entity (auto-resolved) ===');
		for (const g of cross) {
			const parts = (g.resolved ?? [])
				.map((r) => `${r.entity}: ${r.finalTitle}${r.kept ? ' [kept]' : ''}`)
				.join('  |  ');
			console.log(`* ${JSON.stringify(g.baseTitle)} → ${parts}`);
		}
		console.log('');
	}

	if (within.length) {
		console.log('=== Within-entity (report-only, unresolved) ===');
		for (const g of within) {
			const entity = g.occupants[0]?.entity ?? '?';
			console.log(`* ${JSON.stringify(g.baseTitle)} ← ${entity} ×${g.occupants.length}`);
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
