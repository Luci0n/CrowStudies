# CrowStudies

Short, hands-on courses that teach one idea at a time and then let you practice
it. This is a static site with no build step or dependencies. Every page is
plain HTML, CSS, and JavaScript, ready for GitHub Pages.

**Live courses**

| Course | Path | What it covers |
| --- | --- | --- |
| Music theory | `/music/` | Scales, degrees, triads, harmony, and modes, practiced on a playable keyboard |
| Japanese kana | `/japanese/` | All 46 hiragana and 46 katakana row by row, look-alike pairs, and guided writing for the vowel rows |
| Chinese foundations | `/chinese/` | Mandarin tones, common radicals, starter characters, and stroke-order practice |

Planned: medicine, philosophy, psychology, more languages.

## Layout

```
index.html            home page and subject cards
assets/site.css       design tokens, site chrome, shared components
assets/quiz.js        the teach-then-drill engine every course runs on
music/index.html      music theory course (theory + audio engine, lessons screen)
japanese/index.html   kana course (kana data, mnemonics, look-alikes)
chinese/index.html    Mandarin tones, radicals, starter characters, and writing practice
assets/vendor/         bundled third-party browser libraries and their licenses
assets/hanzi-data/     character stroke data used by the writing exercises
assets/kana-data/      Japanese kana stroke data used by the writing exercises
```

## How a course is defined

A course hands `CrowQuiz` a list of units. A unit holds ordered steps; a step is
one idea to teach plus the question generators that drill it. The engine builds
the session queue (teach card → 2–3 questions on that idea → next card → mixed
review), renders the screens, and keeps hearts, XP and progress.

```js
CrowQuiz({
  course: 'japanese',            // localStorage namespace
  title:  'Japanese kana',
  units:  [ { id, title, blurb, color, icon, hint, steps: [
    { title, body, demo, questions, gens: [fn] }
  ] } ],
  types:  { myQuestionType: function (area, q, api) { /* api.finish(bool) */ } },
  sounds: { correct, wrong, fanfare },
  extra:  { label: 'Lessons', build: function (el) {} }   // optional reference screen
}).start('#app');
```

Built-in question types are `mcq` (`choices`, `correctIndex`) and `type`
(`answer`, `alts`). Other question types are supplied through `types`; the music
course uses that for its keyboard questions.

Progress is stored in `localStorage` under `crowstudies_<course>`, per device.

## Deploying

Push to GitHub, then **Settings → Pages → Build and deployment → Deploy from a
branch → `main` / `(root)`**. The site is served at
`https://<user>.github.io/CrowStudies/`.

All links are relative, so the site also works at a custom domain, in a
subfolder, or opened straight from disk. `.nojekyll` stops GitHub from running
Jekyll over the files.

## License

Personal project. Do what you like with it.

## Audio assets

`assets/sfx/` contains a small selection from Kenney's Interface Sounds pack,
licensed CC0 1.0. The bundled license is included alongside the files.

## Chinese writing practice

The Chinese course bundles [Hanzi Writer](https://chanind.github.io/hanzi-writer/)
(MIT) and the selected character data from Make Me a Hanzi (Arphic Public
License). The practice canvas checks the expected stroke order and compares the
shape of each drawn stroke with the reference; it is deliberately forgiving of
small variations rather than being a handwriting OCR system. Licenses are kept
beside the bundled files.

The Japanese writing exercises use the same MIT-licensed practice engine with
Japanese character data from `@k1low/hanzi-writer-data-jp`; its upstream license
notice is included in `assets/kana-data/`.
