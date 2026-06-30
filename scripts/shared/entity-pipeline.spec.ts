import { describe, expect, test } from 'bun:test';
import { prepareTitleResolution } from './title-resolver.ts';
import { getEntity } from './entity-registry.ts';
import { renderItem } from './entity-pipeline.ts';

// Regression test: enemy D-19 Dart is a cross-entity collision loser (gears
// wins the bare title). The rendered skeleton must transcludes the resolved
// title "D-19 Dart (Enemy)/source", not the raw "D-19 Dart/source".
describe('entity-pipeline: resolved title stamped into render context', () => {
	test('D-19 Dart (Enemy) skeleton transcludes resolved title, not raw title', async () => {
		await prepareTitleResolution();
		const enemies = await getEntity('enemies');

		const dart = enemies.loadItems().find((e) => enemies.basePageTitle(e) === 'D-19 Dart');
		expect(dart).toBeDefined();

		const { skeleton } = await renderItem(
			{
				templateName: enemies.templateName,
				skeletonTemplateName: enemies.skeletonTemplateName,
				context: enemies.contextBuilder,
				titleFn: enemies.pageTitle
			},
			dart!
		);

		expect(skeleton).not.toBeNull();
		expect(skeleton).toContain('{{#lst:D-19 Dart (Enemy)/source|');
		expect(skeleton).not.toContain('{{#lst:D-19 Dart/source|');
	});
});
