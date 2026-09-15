import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const sets = {
  hiragana: ['あ','い','う','え','お','か','き','く','け','こ','さ','し','す','せ','そ','た','ち','つ','て','と','な','に','ぬ','ね','の','は','ひ','ふ','へ','ほ','ま','み','む','め','も','や','ゆ','よ','ら','り','る','れ','ろ','わ','を','ん'],
  katakana: ['ア','イ','ウ','エ','オ','カ','キ','ク','ケ','コ','サ','シ','ス','セ','ソ','タ','チ','ツ','テ','ト','ナ','ニ','ヌ','ネ','ノ','ハ','ヒ','フ','ヘ','ホ','マ','ミ','ム','メ','モ','ヤ','ユ','ヨ','ラ','リ','ル','レ','ロ','ワ','ヲ','ン']
};
let checked = 0;
for (const [script, characters] of Object.entries(sets)) {
  if (characters.length !== 46) throw new Error(`${script} must contain 46 base kana`);
  for (const character of characters) {
    const file = join(root, 'assets', 'kana-stroke-data', script, `${character}.json`);
    if (!existsSync(file)) throw new Error(`Missing ${script} data for ${character}`);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.charCode !== character.codePointAt(0)) throw new Error(`Wrong character data in ${file}`);
    if (!Array.isArray(data.strokes) || !data.strokes.length || !data.strokes.every(s => typeof s.value === 'string' && s.value.length > 8)) throw new Error(`Invalid paths for ${character}`);
    if (!Array.isArray(data.medians) || data.medians.length !== data.strokes.length || !data.medians.every(m => Array.isArray(m.value) && m.value.length > 1)) throw new Error(`Invalid medians for ${character}`);
    checked++;
  }
}
const hiraRi = JSON.parse(readFileSync(join(root, 'assets', 'kana-stroke-data', 'hiragana', 'り.json'), 'utf8'));
const kataRi = JSON.parse(readFileSync(join(root, 'assets', 'kana-stroke-data', 'katakana', 'リ.json'), 'utf8'));
if (hiraRi.strokes[0].value === kataRi.strokes[0].value) throw new Error('Hiragana り and katakana リ must have different source paths');
console.log(`Japanese kana stroke data: ${checked}/92 files valid; り and リ are distinct.`);
