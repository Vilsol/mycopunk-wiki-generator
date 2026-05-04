// Generic Pattern-A wiki uploader. Dispatches on `--entity=NAME` (e.g.
// `--entity=upgrades`, `--entity=gears`).
//
// For each item:
//   `<base>.source.wiki`    →  wiki page `<Title>/source` (bot-owned)
//                              · always overwrite when content differs
//                              · skip when identical
//                              · create when missing
//
//   `<base>.skeleton.wiki`  →  wiki page `<Title>` (curator-owned)
//                              · create only when missing
//                              · NEVER overwrite an existing page; flag for
//                                manual review (or honour --force-titles)
//
// Per-entity classifier configs live under `scripts/shared/entities/<entity>.ts`.
// Tracked curator configuration files (force-overwrite, preserved) live
// under `wiki-config/<entity>/`.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, entityConfigDir, entityOutputDir, getProjectRoot } from './shared/paths.ts';
import { editPage, fetchPagesContent, loginBot } from './shared/wiki-client.ts';
import {
	createRateLimiter,
	knownEntities,
	resolveEntity,
	runWithConcurrency,
	relPath,
	type EntityClassifierConfig,
	type EntityUploadConfig
} from './shared/upload-pipeline.ts';
import { loadGameVersion } from './shared/dump.ts';
import { normalizeContent, pageTitleToUrl } from './shared/wiki-text.ts';

const RATE_LIMIT_MS = 1000;
const UPLOAD_CONCURRENCY = 1;

interface CliOptions {
	entity: string;
	all: boolean;
	dryRun: boolean;
	itemFilter?: string; // matched against config.identLabel
	reportPath?: string;
	skipSource: boolean;
	skipSkeleton: boolean;
	overwriteSafe: boolean;
	forceAll: boolean;
	forceTitlesPath?: string;
	forceTitles: Set<string>;
}

type SourceAction = 'create' | 'update' | 'skip';
type HostAction = 'create' | 'overwrite' | 'flag' | 'skip';

interface SourcePagePlan<T> {
	item: T;
	pageTitle: string;
	url: string;
	filePath: string;
	action: SourceAction;
	reason?: string;
}

interface HostPagePlan<T> {
	item: T;
	pageTitle: string;
	url: string;
	filePath: string;
	action: HostAction;
	reason?: string;
	classification?: ContentClassification;
	staleSectionRefs?: string[];
}

interface FlaggedHostEntry {
	pageTitle: string;
	url: string;
	identLabel: string;
	contentClass: ContentClass;
	safeToOverwrite: boolean;
	curatorEvidence: string[];
	staleSectionRefs?: string[];
}

interface RunReport {
	generatedAt: string;
	entity: string;
	gameVersion: string;
	dryRun: boolean;
	summary: {
		source: Record<SourceAction, number>;
		host: Record<HostAction, number>;
		errors: number;
	};
	flaggedHostPages: FlaggedHostEntry[];
	sourceErrors: { pageTitle: string; error: string }[];
	hostErrors: { pageTitle: string; error: string }[];
}

function extractLstReferences(text: string): Set<string> {
	const out = new Set<string>();
	const re = /\{\{#lst\s*:\s*[^|}]+\|\s*([^}]+?)\s*\}\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) out.add(m[1].trim());
	return out;
}

function extractDefinedSections(text: string): Set<string> {
	const out = new Set<string>();
	const re = /<section\s+begin\s*=\s*"([^"]+)"\s*\/>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) out.add(m[1].trim());
	return out;
}

function stripBoilerplate(content: string, classifier: EntityClassifierConfig): string {
	let s = content;
	// Entity-specific infobox template invocation.
	s = s.replace(classifier.infoboxStripPattern, '');
	// Legacy inline "Important Pages" navigation table copy-pasted onto
	// pre-migration upgrade pages.
	s = s.replace(/\{\|\s*class="wikitable"\s+width="100%"[\s\S]*?\|\}/g, '');
	// Pattern-A navigation-template transclusions.
	s = s.replace(/\{\{(?:Important|Related) Pages\}\}/g, '');
	// Bot-managed LST transclusion calls.
	s = s.replace(/\{\{#lst:[^}]+\}\}/g, '');
	s = s.replace(/\[\[Category:[^\]]+\]\]/g, '');
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	for (const p of classifier.placeholderPhrases) s = s.split(p).join('');
	// Layout/markup the bot emits in otherwise curator-owned sections. These
	// would otherwise cause the classifier to falsely treat the section as
	// curator-edited the next time the bot runs against its own output.
	for (const re of classifier.botEmittedPatterns ?? []) s = s.replace(re, '');
	return s;
}

interface SectionBody {
	heading: string;
	body: string;
}

function parseSections(content: string): SectionBody[] {
	const out: SectionBody[] = [];
	const re = /^(={2,})\s*([^=\n]+?)\s*\1\s*\n([\s\S]*?)(?=^={2,}\s*[^=\n]|$(?![\s\S]))/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		out.push({ heading: m[2].trim(), body: m[3].trim() });
	}
	return out;
}

function preview(s: string, max = 120): string {
	const flat = s.replace(/\s+/g, ' ').trim();
	return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

type ContentClass =
	| 'redirect'
	| 'pattern-a-clean'
	| 'pattern-a-edited'
	| 'legacy-empty'
	| 'legacy-edited'
	| 'unknown';

interface ContentClassification {
	contentClass: ContentClass;
	safeToOverwrite: boolean;
	curatorEvidence: string[];
}

function normalizeProse(s: string): string {
	return s
		.replace(/<[^>]+>/g, '')
		.replace(/[[\]{}|]/g, '')
		.replace(/[.,;:!?'"`]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function classifyHostPage(
	content: string,
	infoboxDescription: string,
	classifier: EntityClassifierConfig
): ContentClassification {
	const trimmed = content.trim();

	if (/^#REDIRECT\s*\[\[[^\]]+\]\]/i.test(trimmed)) {
		return {
			contentClass: 'redirect',
			safeToOverwrite: false,
			curatorEvidence: ['#REDIRECT page']
		};
	}

	const hasLstCalls = /\{\{#lst:/.test(content);
	const stripped = stripBoilerplate(content, classifier);
	const sections = parseSections(stripped);
	const evidence: string[] = [];

	const firstHeading = stripped.search(/^={2,}\s*[^=\n]/m);
	const preambleRaw = firstHeading >= 0 ? stripped.slice(0, firstHeading) : stripped;
	const preambleClean = preambleRaw.replace(/\{\|\s*class="wikitable[^"]*"[\s\S]*?\|\}/g, '');
	const normalizedPreamble = normalizeProse(preambleClean);
	const normalizedDescription = normalizeProse(infoboxDescription);
	if (normalizedPreamble.length > 0 && normalizedPreamble !== normalizedDescription) {
		evidence.push(`(preamble): ${preview(preambleClean.replace(/<[^>]+>/g, '').trim())}`);
	}

	for (const { heading, body } of sections) {
		const headingLower = heading.toLowerCase();
		const bodyText = body.trim();
		if (bodyText === '') continue;

		if (classifier.curatorOnlySections.has(headingLower)) {
			evidence.push(`==${heading}==: ${preview(bodyText)}`);
			continue;
		}

		if (headingLower.includes('how to get') || headingLower === 'acquisition') {
			const bodyNorm = bodyText.replace(/\s+/g, ' ').trim().toLowerCase();
			if (!classifier.cannedAcquisitionPhrases.has(bodyNorm)) {
				evidence.push(`==${heading}==: ${preview(bodyText)}`);
			}
			continue;
		}

		if (
			classifier.autoGenSections.has(headingLower) ||
			[...classifier.autoGenSections].some((s) => headingLower.startsWith(s))
		) {
			continue;
		}

		if (headingLower === 'description') {
			const stripText = bodyText
				.replace(/<[^>]+>/g, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (stripText.split(/[.!?]\s/).filter(Boolean).length >= 2) {
				evidence.push(`==${heading}==: ${preview(bodyText)}`);
			}
			continue;
		}

		evidence.push(`==${heading}==: ${preview(bodyText)}`);
	}

	if (evidence.length > 0) {
		return {
			contentClass: hasLstCalls ? 'pattern-a-edited' : 'legacy-edited',
			safeToOverwrite: false,
			curatorEvidence: evidence
		};
	}

	return {
		contentClass: hasLstCalls ? 'pattern-a-clean' : 'legacy-empty',
		safeToOverwrite: true,
		curatorEvidence: []
	};
}

async function uploadViaApi(
	wikiFile: string,
	pageTitle: string,
	gameVersion: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const text = fs.readFileSync(wikiFile, 'utf8');
		await editPage(pageTitle, text, `Update auto-generated content for ${gameVersion}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		entity: '',
		all: false,
		dryRun: false,
		skipSource: false,
		skipSkeleton: false,
		overwriteSafe: false,
		forceAll: false,
		forceTitles: new Set()
	};
	for (const arg of argv) {
		if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--skip-source') opts.skipSource = true;
		else if (arg === '--skip-skeleton') opts.skipSkeleton = true;
		else if (arg === '--overwrite-safe') opts.overwriteSafe = true;
		else if (arg === '--force-all') opts.forceAll = true;
		else if (arg === '--all') opts.all = true;
		else if (arg.startsWith('--entity=')) opts.entity = arg.slice('--entity='.length);
		else if (arg.startsWith('--filter=')) opts.itemFilter = arg.slice('--filter='.length);
		else if (arg.startsWith('--report=')) opts.reportPath = arg.slice('--report='.length);
		else if (arg.startsWith('--force-titles='))
			opts.forceTitlesPath = arg.slice('--force-titles='.length);
		else if (arg === '--help' || arg === '-h') {
			console.log(`Usage: bun scripts/upload-wiki.ts (--entity=NAME | --all) [options]

Required (one of):
  --entity=NAME             One entity (${knownEntities().join(' | ')})
  --all                     Every registered entity

Options:
  --dry-run                 Plan and report without uploading
  --filter=IDENT            Limit to one item (matched against the entity's identLabel)
  --report=PATH             Write JSON report to PATH (default: <wiki-source>/<entity>/upload-report.json)
                            Ignored when --all is used (per-entity reports written individually).
  --skip-source             Skip /source pages (only handle skeletons)
  --skip-skeleton           Skip skeleton pages (only handle /source)
  --overwrite-safe          Overwrite host pages classified as safe
  --force-all               Overwrite EVERY existing host page (still skips
                            #REDIRECT pages). Use with care — bypasses the
                            curator-content classifier entirely.
  --force-titles=PATH       Read host page titles to force-overwrite
                            (default: wiki-config/<entity>/force-overwrite-titles.txt)
                            Ignored when --all is used.
  --help, -h                Show this help
`);
			process.exit(0);
		} else {
			console.warn(`Unknown argument: ${arg}`);
		}
	}
	if (!opts.entity && !opts.all) {
		console.error('Pass --entity=<name> or --all.');
		process.exit(1);
	}
	return opts;
}

// Module-level rate limiter shared across all entities in `--all` runs.
const sharedRateLimit = createRateLimiter(RATE_LIMIT_MS);

interface UploadOneSummary {
	errors: number;
	flagged: number;
}

async function uploadOneEntity(
	entityName: string,
	baseOptions: CliOptions,
	gameVersion: string
): Promise<UploadOneSummary> {
	const config = (await resolveEntity(entityName)) as EntityUploadConfig<unknown>;
	console.log(`\n──── ${config.name} ────`);

	const wikiDir = entityOutputDir(import.meta.url, config.name, 'wiki-source');
	const configDir = entityConfigDir(import.meta.url, config.name);

	if (!fs.existsSync(wikiDir)) {
		console.warn(`(no generated output at ${relPath(wikiDir)} — skip)`);
		return { errors: 0, flagged: 0 };
	}

	// Per-entity options scope: reset force-titles for each entity in --all
	// runs so one entity's list doesn't bleed into the next.
	const options: CliOptions = {
		...baseOptions,
		forceTitles: new Set(baseOptions.forceTitles)
	};
	const reportPath =
		baseOptions.all || !options.reportPath
			? path.join(wikiDir, 'upload-report.json')
			: options.reportPath;

	// Per-entity force-titles file (skipped when --all is used since it
	// would only apply to a single entity's wiki-config dir).
	if (!options.all) {
		const forceTitlesPath =
			options.forceTitlesPath ?? path.join(configDir, 'force-overwrite-titles.txt');
		if (fs.existsSync(forceTitlesPath)) {
			const raw = fs.readFileSync(forceTitlesPath, 'utf8');
			for (const line of raw.split('\n')) {
				const t = line.replace(/#.*$/, '').trim();
				if (t) options.forceTitles.add(t);
			}
			console.log(
				`Loaded ${options.forceTitles.size} force-overwrite title(s) from ${relPath(forceTitlesPath)}`
			);
		}
	} else {
		// Auto-pick up wiki-config/<entity>/force-overwrite-titles.txt during --all.
		const forceTitlesPath = path.join(configDir, 'force-overwrite-titles.txt');
		if (fs.existsSync(forceTitlesPath)) {
			const raw = fs.readFileSync(forceTitlesPath, 'utf8');
			for (const line of raw.split('\n')) {
				const t = line.replace(/#.*$/, '').trim();
				if (t) options.forceTitles.add(t);
			}
			if (options.forceTitles.size > 0) {
				console.log(
					`Loaded ${options.forceTitles.size} force-overwrite title(s) from ${relPath(forceTitlesPath)}`
				);
			}
		}
	}

	const items = config.loadItems();
	const itemsBySafeFilename = new Map<string, unknown>();
	for (const it of items) itemsBySafeFilename.set(config.safeFilename(it), it);

	const dirEntries = fs.readdirSync(wikiDir);
	const bases = new Set<string>();
	for (const f of dirEntries) {
		if (f.endsWith('.source.wiki')) bases.add(f.slice(0, -'.source.wiki'.length));
		else if (f.endsWith('.skeleton.wiki')) bases.add(f.slice(0, -'.skeleton.wiki'.length));
	}

	type Pair = {
		item: unknown;
		pageTitle: string;
		sourcePath?: string;
		skeletonPath?: string;
	};
	const pairs: Pair[] = [];
	const missingItems: string[] = [];
	for (const base of bases) {
		const item = itemsBySafeFilename.get(base);
		if (!item) {
			missingItems.push(base);
			continue;
		}
		if (options.itemFilter && config.identLabel(item) !== options.itemFilter) continue;
		const sourcePath = path.join(wikiDir, `${base}.source.wiki`);
		const skeletonPath = path.join(wikiDir, `${base}.skeleton.wiki`);
		pairs.push({
			item,
			pageTitle: config.pageTitle(item),
			sourcePath: fs.existsSync(sourcePath) ? sourcePath : undefined,
			skeletonPath: fs.existsSync(skeletonPath) ? skeletonPath : undefined
		});
	}

	if (missingItems.length > 0) {
		console.warn(
			`⚠ ${missingItems.length} generated file(s) without a matching ${config.name} item — skipping:`
		);
		for (const b of missingItems.slice(0, 5)) console.warn(`    ${b}`);
		if (missingItems.length > 5) console.warn(`    … and ${missingItems.length - 5} more`);
	}
	if (options.itemFilter && pairs.length === 0) {
		console.warn(`(no item matched --filter=${options.itemFilter} — skip)`);
		return { errors: 0, flagged: 0 };
	}

	console.log(`Found ${pairs.length} ${config.name} to process.`);

	const allTitles: string[] = [];
	for (const p of pairs) {
		if (p.skeletonPath) allTitles.push(p.pageTitle);
		if (p.sourcePath) allTitles.push(`${p.pageTitle}/source`);
	}
	console.log(`Fetching current state of ${allTitles.length} wiki page(s)…`);
	const remote = await fetchPagesContent(allTitles);

	const sourcePlans: SourcePagePlan<unknown>[] = [];
	for (const p of pairs) {
		if (!p.sourcePath || options.skipSource) continue;
		const title = `${p.pageTitle}/source`;
		const localContent = normalizeContent(fs.readFileSync(p.sourcePath, 'utf8'));
		const remoteEntry = remote.get(title);
		let action: SourceAction;
		let reason: string | undefined;
		if (!remoteEntry?.exists) action = 'create';
		else if (normalizeContent(remoteEntry.content ?? '') === localContent) {
			action = 'skip';
			reason = 'identical';
		} else action = 'update';
		sourcePlans.push({
			item: p.item,
			pageTitle: title,
			url: pageTitleToUrl(title),
			filePath: p.sourcePath,
			action,
			reason
		});
	}

	const hostPlans: HostPagePlan<unknown>[] = [];
	for (const p of pairs) {
		if (!p.skeletonPath || options.skipSkeleton) continue;
		const title = p.pageTitle;
		const skeletonContent = normalizeContent(fs.readFileSync(p.skeletonPath, 'utf8'));
		const remoteEntry = remote.get(title);
		const plan: HostPagePlan<unknown> = {
			item: p.item,
			pageTitle: title,
			url: pageTitleToUrl(title),
			filePath: p.skeletonPath,
			action: 'skip'
		};
		if (!remoteEntry?.exists) {
			plan.action = 'create';
		} else {
			const remoteContent = remoteEntry.content ?? '';
			const classification = classifyHostPage(
				remoteContent,
				config.infoboxDescription(p.item),
				config.classifier
			);
			plan.classification = classification;

			const forced =
				(options.forceTitles.has(title) || options.forceAll) &&
				classification.contentClass !== 'redirect';
			if (forced || (options.overwriteSafe && classification.safeToOverwrite)) {
				plan.action = normalizeContent(remoteContent) === skeletonContent ? 'skip' : 'overwrite';
				if (plan.action === 'skip') plan.reason = 'identical';
				else if (forced) plan.reason = 'forced';
			} else {
				plan.action = 'flag';
			}

			const lstRefs = extractLstReferences(remoteContent);
			if (p.sourcePath && lstRefs.size > 0) {
				const sourceText = fs.readFileSync(p.sourcePath, 'utf8');
				const defined = extractDefinedSections(sourceText);
				const stale = [...lstRefs].filter((r) => !defined.has(r));
				if (stale.length > 0) plan.staleSectionRefs = stale;
			}
		}
		hostPlans.push(plan);
	}

	const summary: RunReport['summary'] = {
		source: { create: 0, update: 0, skip: 0 },
		host: { create: 0, overwrite: 0, flag: 0, skip: 0 },
		errors: 0
	};
	for (const s of sourcePlans) summary.source[s.action]++;
	for (const h of hostPlans) summary.host[h.action]++;

	console.log(`\nPlanned actions:`);
	console.log(
		`  /source: ${summary.source.create} create · ${summary.source.update} update · ${summary.source.skip} skip`
	);
	console.log(
		`  host:    ${summary.host.create} create · ${summary.host.overwrite} overwrite · ${summary.host.flag} flag · ${summary.host.skip} skip`
	);

	const sourceErrors: RunReport['sourceErrors'] = [];
	const hostErrors: RunReport['hostErrors'] = [];

	if (!options.dryRun) {
		const rateLimit = sharedRateLimit;

		const sourceWork = sourcePlans.filter((p) => p.action !== 'skip');
		console.log(
			`\nUploading ${sourceWork.length} /source page(s) (concurrency=${UPLOAD_CONCURRENCY}, ≤${1000 / RATE_LIMIT_MS}/s)…`
		);
		await runWithConcurrency(sourceWork, UPLOAD_CONCURRENCY, async (plan, i) => {
			await rateLimit();
			console.log(
				`  [${i + 1}/${sourceWork.length}] ${plan.action.toUpperCase()} ${plan.pageTitle}`
			);
			const result = await uploadViaApi(plan.filePath, plan.pageTitle, gameVersion);
			if (!result.ok) {
				summary.errors++;
				sourceErrors.push({ pageTitle: plan.pageTitle, error: result.error });
				console.error(`    ✗ ${result.error.split('\n')[0]}`);
			}
		});

		const hostWork = hostPlans.filter((p) => p.action === 'create' || p.action === 'overwrite');
		const createCount = hostWork.filter((p) => p.action === 'create').length;
		const overwriteCount = hostWork.filter((p) => p.action === 'overwrite').length;
		console.log(
			`\nWriting ${hostWork.length} host page(s) (${createCount} create, ${overwriteCount} overwrite)…`
		);
		await runWithConcurrency(hostWork, UPLOAD_CONCURRENCY, async (plan, i) => {
			await rateLimit();
			console.log(`  [${i + 1}/${hostWork.length}] ${plan.action.toUpperCase()} ${plan.pageTitle}`);
			const result = await uploadViaApi(plan.filePath, plan.pageTitle, gameVersion);
			if (!result.ok) {
				summary.errors++;
				hostErrors.push({ pageTitle: plan.pageTitle, error: result.error });
				console.error(`    ✗ ${result.error.split('\n')[0]}`);
			}
		});
	}

	const flaggedPlans = hostPlans.filter((p) => p.action === 'flag');
	const flaggedHostPages: FlaggedHostEntry[] = flaggedPlans.map((p) => ({
		pageTitle: p.pageTitle,
		url: p.url,
		identLabel: config.identLabel(p.item),
		contentClass: p.classification?.contentClass ?? 'unknown',
		safeToOverwrite: p.classification?.safeToOverwrite ?? false,
		curatorEvidence: p.classification?.curatorEvidence ?? [],
		staleSectionRefs: p.staleSectionRefs
	}));
	const report: RunReport = {
		generatedAt: new Date().toISOString(),
		entity: config.name,
		gameVersion,
		dryRun: options.dryRun,
		summary,
		flaggedHostPages,
		sourceErrors,
		hostErrors
	};
	ensureDir(path.dirname(reportPath));
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

	console.log(`\n=== Summary ===`);
	console.log(
		`  /source pages    create=${summary.source.create}  update=${summary.source.update}  skip=${summary.source.skip}`
	);
	console.log(
		`  host pages       create=${summary.host.create}  overwrite=${summary.host.overwrite}  flag=${summary.host.flag}  skip=${summary.host.skip}`
	);
	console.log(`  errors           ${summary.errors}`);
	console.log(`  report           ${relPath(reportPath)}`);

	if (flaggedHostPages.length > 0) {
		const byClass = flaggedHostPages.reduce<Record<string, number>>((acc, p) => {
			acc[p.contentClass] = (acc[p.contentClass] ?? 0) + 1;
			return acc;
		}, {});
		const safeToOverwrite = flaggedHostPages.filter((p) => p.safeToOverwrite).length;
		const stale = flaggedHostPages.filter((p) => p.staleSectionRefs?.length).length;

		console.log(`\n  ${flaggedHostPages.length} host page(s) flagged for manual review:`);
		const order: ContentClass[] = [
			'legacy-edited',
			'pattern-a-edited',
			'legacy-empty',
			'pattern-a-clean',
			'redirect',
			'unknown'
		];
		const labels: Record<ContentClass, string> = {
			'legacy-edited': 'legacy template + curator content (preserve)',
			'pattern-a-edited': 'Pattern-A skeleton + curator content (preserve)',
			'legacy-empty': 'legacy template, no curator content (safe to overwrite)',
			'pattern-a-clean': 'Pattern-A skeleton, no curator content (safe to overwrite)',
			redirect: '#REDIRECT page (never touch)',
			unknown: 'unclassified (preserve by default)'
		};
		for (const c of order) {
			if (byClass[c]) console.log(`    ${byClass[c].toString().padStart(4)}  ${labels[c]}`);
		}
		if (safeToOverwrite > 0 && !options.overwriteSafe) {
			console.log(
				`\n  ${safeToOverwrite} page(s) classified as safe to overwrite. Re-run with --overwrite-safe.`
			);
		}
		if (stale > 0) {
			console.log(`\n  ${stale} page(s) have stale LST section refs.`);
		}
	}

	return {
		errors: summary.errors,
		flagged: options.dryRun ? 0 : flaggedHostPages.length
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const gameVersion = loadGameVersion();
	console.log(`Game version: ${gameVersion}`);
	if (options.dryRun) console.log(`🔍 Dry run — no edits will be made.`);

	if (!options.dryRun) {
		console.log(`Logging in to MediaWiki API…`);
		await loginBot(getProjectRoot(import.meta.url));
	}

	const targets = options.all ? knownEntities() : [options.entity];

	let totalErrors = 0;
	let totalFlagged = 0;
	for (const name of targets) {
		const r = await uploadOneEntity(name, options, gameVersion);
		totalErrors += r.errors;
		totalFlagged += r.flagged;
	}

	if (options.all) {
		console.log(`\n=== Total ===`);
		console.log(`  errors  ${totalErrors}`);
		console.log(`  flagged ${totalFlagged}`);
	}

	// Exit codes:  0 clean · 1 upload errors · 2 flagged hosts (CI gate)
	if (totalErrors > 0) process.exit(1);
	if (totalFlagged > 0 && !options.dryRun) process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
