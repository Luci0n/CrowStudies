import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'assets/pronunciation/japanese/kana-audio-manifest.json');
const mapPath = resolve(root, 'assets/pronunciation/japanese/kana-audio-map.js');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')).map(item => ({
  ...item,
  asset: item.asset || `assets/pronunciation/japanese/kana/${item.romaji}.mp3`,
  source: item.source || `https://commons.wikimedia.org/wiki/File:${item.originalFilename.replaceAll(' ', '_')}`,
  author: item.author || 'Hakatanoshio117117',
  license: item.license || 'Public Domain / PD-self',
  modifications: item.modifications || ['silence trim', 'loudness normalized']
}));
const expected = ['a','i','u','e','o','ka','ki','ku','ke','ko','sa','shi','su','se','so','ta','chi','tsu','te','to','na','ni','nu','ne','no','ha','hi','fu','he','ho','ma','mi','mu','me','mo','ya','yu','yo','ra','ri','ru','re','ro','wa','wo','n'];
const failures = [];

if (!Array.isArray(manifest) || manifest.length !== 46) failures.push(`Expected exactly 46 manifest entries; found ${manifest.length}.`);
const romaji = manifest.map(item => item.romaji);
for (const name of expected) if (romaji.filter(value => value === name).length !== 1) failures.push(`Expected one ${name} mapping.`);
const mapText = readFileSync(mapPath, 'utf8');
for (const item of manifest) {
  const asset = resolve(root, item.asset);
  if (!existsSync(asset)) { failures.push(`${item.romaji}: missing ${item.asset}`); continue; }
  if (!statSync(asset).size) { failures.push(`${item.romaji}: zero-byte asset`); continue; }
  const probe = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',asset], { encoding: 'utf8' });
  const duration = Number(probe.stdout.trim());
  if (probe.status !== 0 || !Number.isFinite(duration)) failures.push(`${item.romaji}: cannot decode`);
  else if (duration < 0.08 || duration > 4) failures.push(`${item.romaji}: implausible duration ${duration.toFixed(3)}s`);
  if (item.vowel && duration > 0.5) failures.push(`${item.romaji}: vowel is too long (${duration.toFixed(3)}s), likely repeated.`);
  if (!mapText.includes(`'${item.kana}':'${item.romaji}'`)) failures.push(`${item.romaji}: absent from local kana map`);
}
if (!mapText.includes('strict: true')) failures.push('Japanese base kana mapping is not strict-local.');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Japanese kana audio audit passed: ${manifest.length}/46 local assets; no base-kana TTS fallback.`);
