// Build per-variant preview assets (still + 360° animated webp) for every
// skin whose `Skin.Previews` entry has a rendered mp4 on disk. Stills come
// from the pre-extracted first visible frame; the animated webp is
// transcoded from the mp4 when ffmpeg is available, otherwise skipped.
//
// Why webp and not webm: Miraheze blocks webm uploads but permits webp.
// (Animated webp doesn't render inline via wikitext on this wiki, but the
// upload pipeline + raw <img> hotwire on the skin pages bypasses that.)
//
// Usage: bun scripts/generate-skin-previews.ts [options] [<base-dir>]
//   base-dir defaults to ~/.local/share/Steam/steamapps/common/Mycopunk
//
// Options:
//   --stills-only       Only refresh jpg stills; skip webp transcoding entirely
//   --animations-only   Only transcode webps; skip jpg copying
//   --filter=characters Process only character skins (Bruiser/Glider/Scrapper/Wrangler)
//   --filter=weapons    Process only weapon/gun skins (everything else)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSkins, plainName, variantPreviewFilename, type Skin } from './shared/load-skins.ts';
import { loadCharacters } from './shared/load-characters.ts';
import { entityOutputDir, ensureDir } from './shared/paths.ts';

const DEFAULT_BASE = `${process.env.HOME}/.local/share/Steam/steamapps/common/Mycopunk`;
// First visible frame of the rotation — matches what the game/Steam/Discord
// show for the same skin, which is the predictable default for users.
const STILL_FRAME = 'frame_000.jpg';

type FFmpegMode = 'direct' | 'nix' | null;

function detectFFmpegMode(): FFmpegMode {
	if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'direct';
	const nix = spawnSync('nix-shell', ['-p', 'ffmpeg', '--run', 'ffmpeg -version'], {
		stdio: 'ignore'
	});
	if (nix.status === 0) return 'nix';
	return null;
}

// Animated-WebP encode. Source mp4s are 2160×2160 @ 25 Mbps for 4 seconds —
// way oversized for a wiki preview. We downscale to 720×720 (still 4× a
// 180px display thumbnail, plenty for retina) and re-sample to 30 fps with
// lanczos. q=80 plus compression_level=6 keeps each output around 1.5–2 MB
// while preserving the saturation/detail of the original render.
//
// `-an` drops audio (none present). `-fps_mode passthrough` keeps ffmpeg
// from re-jiggering frame timing during the codec switch.
function ffmpegArgs(srcMp4: string, outWebp: string): string[] {
	return [
		'-y',
		'-loglevel',
		'error',
		'-i',
		srcMp4,
		'-vcodec',
		'libwebp',
		'-vf',
		'fps=30,scale=720:720:flags=lanczos',
		'-lossless',
		'0',
		'-compression_level',
		'6',
		'-q:v',
		'80',
		'-loop',
		'0',
		'-preset',
		'picture',
		'-an',
		'-fps_mode',
		'passthrough',
		outWebp
	];
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function transcodeWebp(mode: FFmpegMode, srcMp4: string, outWebp: string): boolean {
	if (mode === 'direct') {
		const r = spawnSync('ffmpeg', ffmpegArgs(srcMp4, outWebp), { stdio: 'inherit' });
		return r.status === 0;
	}
	if (mode === 'nix') {
		const cmd = ['ffmpeg', ...ffmpegArgs(srcMp4, outWebp)].map(shellEscape).join(' ');
		const r = spawnSync('nix-shell', ['-p', 'ffmpeg', '--run', cmd], { stdio: 'inherit' });
		return r.status === 0;
	}
	return false;
}

interface VariantTask {
	skin: Skin;
	parent: string;
	preset: string;
	mp4Path: string; // absolute
	previewDir: string; // absolute (folder containing mp4 + frames)
	stillFile: string; // local frame in previewDir
}

type FilterMode = 'characters' | 'weapons' | null;

interface CliOptions {
	baseDir: string;
	stillsOnly: boolean;
	animationsOnly: boolean;
	filter: FilterMode;
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		baseDir: DEFAULT_BASE,
		stillsOnly: false,
		animationsOnly: false,
		filter: null
	};
	for (const arg of argv) {
		if (arg === '--stills-only') opts.stillsOnly = true;
		else if (arg === '--animations-only') opts.animationsOnly = true;
		else if (arg.startsWith('--filter=')) {
			const v = arg.slice('--filter='.length);
			if (v === 'characters' || v === 'weapons') opts.filter = v;
			else {
				console.error(`✗ Invalid --filter=${v} (expected: characters | weapons)`);
				process.exit(1);
			}
		} else if (arg === '--help' || arg === '-h') {
			console.log(
				`Usage: bun scripts/generate-skin-previews.ts [options] [<base-dir>]

Options:
  --stills-only         Only refresh jpg stills; skip webp transcoding
  --animations-only     Only transcode webps; skip jpg copying
  --filter=characters   Only process character skins (Bruiser/Glider/Scrapper/Wrangler)
  --filter=weapons      Only process weapon/gun skins (everything else)
  --help, -h            Show this help`
			);
			process.exit(0);
		} else if (!arg.startsWith('--')) {
			opts.baseDir = arg;
		}
	}
	if (opts.stillsOnly && opts.animationsOnly) {
		console.error('✗ --stills-only and --animations-only are mutually exclusive');
		process.exit(1);
	}
	return opts;
}

function loadCharacterKeys(): Set<string> {
	const keys = new Set<string>();
	for (const c of loadCharacters()) {
		if (c.APIName) keys.add(c.APIName);
	}
	return keys;
}

function collectTasks(
	baseDir: string,
	filter: FilterMode
): { tasks: VariantTask[]; declared: number; missing: number; filtered: number } {
	const skins = loadSkins();
	const characterKeys = filter ? loadCharacterKeys() : null;
	const tasks: VariantTask[] = [];
	let declared = 0;
	let missing = 0;
	let filtered = 0;

	for (const s of skins) {
		const previews = s.skin.Previews ?? {};
		for (const parent of Object.keys(previews)) {
			const isCharacter = characterKeys ? characterKeys.has(parent) : false;
			if (filter === 'characters' && !isCharacter) {
				declared += Object.keys(previews[parent] ?? {}).length;
				filtered += Object.keys(previews[parent] ?? {}).length;
				continue;
			}
			if (filter === 'weapons' && isCharacter) {
				declared += Object.keys(previews[parent] ?? {}).length;
				filtered += Object.keys(previews[parent] ?? {}).length;
				continue;
			}
			for (const preset of Object.keys(previews[parent] ?? {})) {
				declared++;
				const rel = previews[parent][preset];
				if (!rel) continue;
				const mp4Path = path.join(baseDir, rel);
				const previewDir = path.dirname(mp4Path);
				const stillFile = path.join(previewDir, STILL_FRAME);
				if (!fs.existsSync(mp4Path) || !fs.existsSync(stillFile)) {
					missing++;
					continue;
				}
				tasks.push({ skin: s, parent, preset, mp4Path, previewDir, stillFile });
			}
		}
	}
	return { tasks, declared, missing, filtered };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const baseDir = path.resolve(opts.baseDir);
	if (!fs.existsSync(baseDir)) {
		console.error(`✗ Base directory does not exist: ${baseDir}`);
		process.exit(1);
	}

	const outputDir = entityOutputDir(import.meta.url, 'skins', 'icons');
	ensureDir(outputDir);

	const { tasks, declared, missing, filtered } = collectTasks(baseDir, opts.filter);
	const ffmpegMode = opts.stillsOnly ? null : detectFFmpegMode();

	console.log(`Base directory: ${baseDir}`);
	console.log(`Output dir:     ${outputDir}`);
	console.log(`Declared variants: ${declared}`);
	if (opts.filter) console.log(`Filtered out (--filter=${opts.filter}): ${filtered}`);
	console.log(`Renderable:        ${tasks.length}`);
	console.log(`Skipped (no file): ${missing}`);
	if (opts.stillsOnly) {
		console.log('Mode: stills only (--stills-only)');
	} else if (opts.animationsOnly) {
		console.log('Mode: animations only (--animations-only)');
	}
	if (!opts.stillsOnly) {
		console.log(
			`ffmpeg: ${ffmpegMode === 'direct' ? 'available (direct) — animated webp transcoding enabled' : ffmpegMode === 'nix' ? 'available via nix-shell — animated webp transcoding enabled' : 'NOT FOUND — only stills will be produced (install ffmpeg or have nix-shell available)'}`
		);
	}
	console.log('');

	let stillsOk = 0;
	let stillsErr = 0;
	let webpOk = 0;
	let webpErr = 0;
	let webpSkipped = 0;

	const total = tasks.length;
	const startedAt = Date.now();
	let lastTickAt = startedAt;

	for (let i = 0; i < total; i++) {
		const t = tasks[i];
		const stillName = variantPreviewFilename(t.skin, t.parent, t.preset, 'jpg');
		const webpName = variantPreviewFilename(t.skin, t.parent, t.preset, 'webp');
		const stillOut = path.join(outputDir, stillName);
		const webpOut = path.join(outputDir, webpName);
		const skinLabel = `${plainName(t.skin)} (${t.parent}/${t.preset})`;
		const idx = `[${i + 1}/${total}]`;

		if (!opts.animationsOnly) {
			try {
				fs.copyFileSync(t.stillFile, stillOut);
				stillsOk++;
				if (opts.stillsOnly) console.log(`${idx} ✓ ${skinLabel} — still`);
			} catch (e) {
				console.error(`${idx} ✗ still copy failed for ${stillName}:`, e);
				stillsErr++;
			}
		}

		if (opts.stillsOnly) continue;

		if (ffmpegMode === null) {
			webpSkipped++;
			console.log(`${idx} ⏭ ${skinLabel} — still only (no ffmpeg)`);
			continue;
		}
		if (fs.existsSync(webpOut)) {
			webpOk++;
			console.log(`${idx} ⏭ ${skinLabel} — webp already exists`);
			continue;
		}

		const t0 = Date.now();
		console.log(`${idx} → ${skinLabel} — transcoding…`);
		const ok = transcodeWebp(ffmpegMode, t.mp4Path, webpOut);
		const dt = ((Date.now() - t0) / 1000).toFixed(1);
		if (ok) {
			webpOk++;
			const sizeMB = (fs.statSync(webpOut).size / 1024 / 1024).toFixed(2);
			// ETA based on rolling-average per-task time since this run started.
			const elapsed = (Date.now() - startedAt) / 1000;
			const avg = elapsed / (i + 1);
			const remaining = avg * (total - (i + 1));
			const eta = remaining < 60 ? `${remaining.toFixed(0)}s` : `${(remaining / 60).toFixed(1)}m`;
			console.log(`${idx} ✓ ${skinLabel} — ${dt}s, ${sizeMB} MB · ETA ${eta}`);
		} else {
			webpErr++;
			console.error(`${idx} ✗ ${skinLabel} — transcode failed (${dt}s)`);
		}

		// Throttle: print a heartbeat at most once per 30s in case the loop
		// quiet-skips a long stretch.
		const now = Date.now();
		if (now - lastTickAt > 30_000) {
			lastTickAt = now;
			console.log(
				`   … progress: ${stillsOk} stills, ${webpOk} webp done, ${webpErr} failed (${(((i + 1) / total) * 100).toFixed(1)}%)`
			);
		}
	}

	console.log('\n=== Summary ===');
	console.log(`✓ Stills copied:      ${stillsOk}`);
	if (stillsErr) console.log(`✗ Stills failed:      ${stillsErr}`);
	console.log(`✓ Webp transcoded:    ${webpOk}`);
	if (webpErr) console.log(`✗ Webp failed:        ${webpErr}`);
	if (webpSkipped) console.log(`⚠ Webp skipped (no ffmpeg): ${webpSkipped}`);
	console.log(`📁 Output:            ${outputDir}`);

	if (stillsErr > 0 || webpErr > 0) process.exit(1);
}

await main();
