import { describe, expect, test } from 'bun:test';
import { diffDumps } from './dump-diff.ts';

// Minimal dump with one upgrade, one property carrying rolled values for
// one stat under one upgradable. Mirrors the dump shape diffDumps reads.
function dump(rolls: string[]) {
	return {
		upgrades: {
			'1': {
				ID: '1',
				Name: 'Test',
				Properties: [
					{
						Type: 'UpgradeProperty_Test',
						Label: 'Test Prop',
						RolledValuesByUpgradable: { Gun: { Damage: rolls } }
					}
				]
			}
		}
	};
}

describe('diffDumps rolls', () => {
	test('emits a range delta when the rolled min or max shifts', () => {
		const prev = dump(['0.82', '0.9', '1']);
		const curr = dump(['0.77', '0.9', '1']);
		const change = diffDumps(prev, curr)
			.get('1')
			?.find((c) => c.kind === 'rolls');
		expect(change).toEqual({
			kind: 'rolls',
			property: 'Test Prop',
			stat: 'Damage',
			fromMin: '0.82',
			fromMax: '1',
			toMin: '0.77',
			toMax: '1'
		});
	});

	test('suppresses the rolls change when min and max are unchanged', () => {
		const prev = dump(['0.77', '0.82', '1']);
		const curr = dump(['0.77', '0.9', '1']); // shuffled within [0.77, 1]
		const rolls =
			diffDumps(prev, curr)
				.get('1')
				?.filter((c) => c.kind === 'rolls') ?? [];
		expect(rolls).toEqual([]);
	});

	test('parses signed-percent values for ordering', () => {
		const prev = dump(['-30%', '-35%', '-39.5%']);
		const curr = dump(['-30.5%', '-35%', '-38%']);
		const change = diffDumps(prev, curr)
			.get('1')
			?.find((c) => c.kind === 'rolls');
		// numeric order: -39.5 is min, -30 is max (prev); -38 min, -30.5 max (curr)
		expect(change).toMatchObject({
			fromMin: '-39.5%',
			fromMax: '-30%',
			toMin: '-38%',
			toMax: '-30.5%'
		});
	});
});
