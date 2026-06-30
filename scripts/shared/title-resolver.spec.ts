import { describe, expect, test } from 'bun:test';
import { resolveCollisions, type Occupant } from './title-resolver.ts';

const HIER = ['characters', 'gears', 'upgrades', 'skins', 'enemies'];

function group(map: Record<string, Occupant[]>): Map<string, Occupant[]> {
	return new Map(Object.entries(map));
}

describe('resolveCollisions', () => {
	test('cross-entity: higher-ranked keeps base, loser gets domain suffix', () => {
		const { overrides, report } = resolveCollisions(
			group({
				'D-19 Dart': [
					{ entity: 'enemies', key: 'enemies\x00kart', label: 'Enemy' },
					{ entity: 'gears', key: 'gears\x00kart', label: 'Vehicle' }
				]
			}),
			HIER
		);
		expect(overrides.get('gears\x00kart')).toBeUndefined(); // winner: no override
		expect(overrides.get('enemies\x00kart')).toBe('D-19 Dart (Enemy)');
		expect(report.crossEntityCount).toBe(1);
		expect(report.withinEntityCount).toBe(0);
	});

	test('within-entity collisions are reported but not overridden', () => {
		const { overrides, report } = resolveCollisions(
			group({
				'Constellation (Universal Skin)': [
					{ entity: 'skins', key: 'skins\x00a', label: 'Skin' },
					{ entity: 'skins', key: 'skins\x00b', label: 'Skin' }
				]
			}),
			HIER
		);
		expect(overrides.size).toBe(0);
		expect(report.withinEntityCount).toBe(1);
		expect(report.crossEntityCount).toBe(0);
	});

	test('no collision → no overrides', () => {
		const { overrides, report } = resolveCollisions(
			group({ Unique: [{ entity: 'gears', key: 'gears\x00x', label: 'Vehicle' }] }),
			HIER
		);
		expect(overrides.size).toBe(0);
		expect(report.groups).toEqual([]);
	});

	test('deterministic regardless of occupant order', () => {
		const occ: Occupant[] = [
			{ entity: 'gears', key: 'gears\x00kart', label: 'Vehicle' },
			{ entity: 'enemies', key: 'enemies\x00kart', label: 'Enemy' }
		];
		const a = resolveCollisions(group({ T: occ }), HIER).overrides;
		const b = resolveCollisions(group({ T: [...occ].reverse() }), HIER).overrides;
		expect([...a]).toEqual([...b]);
	});

	test('3-way cross-entity: exactly one keeps base, others suffixed', () => {
		const { overrides } = resolveCollisions(
			group({
				X: [
					{ entity: 'upgrades', key: 'upgrades\x001', label: 'Upgrade' },
					{ entity: 'characters', key: 'characters\x001', label: 'Character' },
					{ entity: 'enemies', key: 'enemies\x001', label: 'Enemy' }
				]
			}),
			HIER
		);
		// characters is highest-ranked → keeps base; other two suffixed.
		expect(overrides.get('characters\x001')).toBeUndefined();
		expect(overrides.get('upgrades\x001')).toBe('X (Upgrade)');
		expect(overrides.get('enemies\x001')).toBe('X (Enemy)');
	});
});

import { finalTitle, titleKey, defaultLabel, ENTITY_HIERARCHY } from './title-resolver.ts';

describe('finalTitle / helpers', () => {
	test('finalTitle falls back to base when nothing prepared for the key', () => {
		expect(finalTitle('nonexistent\x00key', 'Some Title')).toBe('Some Title');
	});

	test('titleKey is entity + null-separated safeFilename', () => {
		expect(titleKey('gears', 'kart')).toBe('gears\x00kart');
	});

	test('defaultLabel title-cases and singularizes the entity name', () => {
		expect(defaultLabel('upgrades')).toBe('Upgrade');
		expect(defaultLabel('characters')).toBe('Character');
	});

	test('hierarchy ranks gears above enemies', () => {
		expect(ENTITY_HIERARCHY.indexOf('gears')).toBeLessThan(ENTITY_HIERARCHY.indexOf('enemies'));
	});
});
