import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const expected = {
  'あ':3,'い':2,'う':2,'え':2,'お':3,'か':3,'き':4,'く':1,'け':3,'こ':2,'さ':3,'し':1,'す':2,'せ':3,'そ':1,'た':4,'ち':2,'つ':1,'て':1,'と':2,'な':4,'に':3,'ぬ':2,'ね':2,'の':1,'は':3,'ひ':1,'ふ':4,'へ':1,'ほ':4,'ま':3,'み':2,'む':3,'め':2,'も':3,'や':3,'ゆ':2,'よ':2,'ら':2,'り':2,'る':1,'れ':2,'ろ':1,'わ':2,'を':3,'ん':1,
  'ア':2,'イ':2,'ウ':3,'エ':3,'オ':3,'カ':2,'キ':3,'ク':2,'ケ':3,'コ':2,'サ':3,'シ':3,'ス':2,'セ':2,'ソ':2,'タ':3,'チ':3,'ツ':3,'テ':3,'ト':2,'ナ':2,'ニ':2,'ヌ':2,'ネ':4,'ノ':1,'ハ':2,'ヒ':2,'フ':1,'ヘ':1,'ホ':4,'マ':2,'ミ':3,'ム':2,'メ':2,'モ':3,'ヤ':2,'ユ':2,'ヨ':3,'ラ':2,'リ':2,'ル':2,'レ':1,'ロ':3,'ワ':2,'ヲ':3,'ン':2
};
for (const [kana, strokeCount] of Object.entries(expected)) {
  const file = join(root, 'assets', 'kana-data', `${kana}.json`);
  if (!existsSync(file)) throw new Error(`Missing writing data for ${kana}`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.strokes) || !Array.isArray(data.medians)) throw new Error(`Invalid writing data for ${kana}`);
  if (data.strokes.length !== strokeCount || data.medians.length !== strokeCount) throw new Error(`${kana}: expected ${strokeCount} strokes, found ${data.strokes.length}`);
  if (!data.strokes.every(path => typeof path === 'string' && path.length > 8)) throw new Error(`Missing stroke outline for ${kana}`);
}
console.log(`Japanese writing data: ${Object.keys(expected).length}/92 kana with verified pen-stroke counts.`);
