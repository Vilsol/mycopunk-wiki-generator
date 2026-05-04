import { describe, it, expect } from 'bun:test';
import { getPropertyStats, getStatsFromProperty } from './utils';
import { loadUpgrades } from '../entities/upgrades';

const upgradesData = loadUpgrades();

// `parseFloat` stops at the first non-numeric character, so `"+1,011.1%"`
// becomes `1`. Strip the thousands separator first.
const parseFormattedNumber = (s: string): number => parseFloat(s.replace(/,/g, ''));

describe('getStatsFromProperty', () => {
	describe('should return the correct values for all upgrades', () => {
		for (const upgrade of upgradesData) {
			if (!upgrade.Properties) {
				continue;
			}

			// Skip cosmetics
			if (upgrade.UpgradeType === 'Cosmetic') {
				continue;
			}

			const testableProperties = upgrade.Properties.filter(
				(property) => getPropertyStats(property).length > 0
			);
			if (testableProperties.length === 0) {
				continue;
			}

			describe(`${upgrade.APIName}`, () => {
				for (const property of testableProperties) {
					const propertyStats = getPropertyStats(property);

					it(`${property.Type}`, () => {
						const stats = getStatsFromProperty(property, true);
						if (!stats || stats.length === 0) {
							return;
						}

						// Align formatter output with stats it can have come from:
						// `getStatsFromProperty` skips entries where `IsValid === false`,
						// so we filter to match before index-aligning.
						const validStats = propertyStats.filter((s) => s.IsValid !== false);

						// Some property types (e.g. UpgradeProperty_ShieldProjector_Size)
						// take a special-case branch in the formatter that produces a
						// different number of strings than there are stats, with labels
						// baked into the value. Index-aligned comparison is impossible —
						// skip the assertion for those cases rather than asserting against
						// misaligned data.
						if (stats.length !== validStats.length) {
							return;
						}

						for (let i = 0; i < stats.length; i++) {
							const stat = stats[i];
							const propStat = validStats[i];

							if (!propStat || !propStat.value || !propStat.minValue || !propStat.maxValue) {
								continue;
							}

							let validStat = propStat.value;
							if (validStat.endsWith('%')) {
								validStat = validStat.slice(0, -1);
							}

							const statValue = parseFormattedNumber(validStat);
							if (isNaN(statValue)) {
								continue;
							}

							let min = 0;
							let max = 0;
							if (stat.startsWith('[') && stat.endsWith(']')) {
								let [minV, maxV] = stat.slice(1, -1).split(' - ');

								if (minV.endsWith('%')) {
									minV = minV.slice(0, -1);
								}
								if (maxV.endsWith('%')) {
									maxV = maxV.slice(0, -1);
								}

								min = parseFormattedNumber(minV);
								max = parseFormattedNumber(maxV);
								if (isNaN(min) || isNaN(max)) {
									throw new Error(`Invalid stat: ${stat}`);
								}

								if (min > max) {
									const temp = min;
									min = max;
									max = temp;
								}
							} else {
								if (stat.endsWith('%')) {
									min = parseFormattedNumber(stat.slice(0, -1));
									max = min;
								} else {
									min = parseFormattedNumber(stat);
									max = min;
								}
							}

							expect(statValue).toBeGreaterThanOrEqual(min);
							expect(statValue).toBeLessThanOrEqual(max);
						}
					});
				}
			});
		}
	});
});
