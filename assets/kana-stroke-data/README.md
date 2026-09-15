# Japanese kana writing data

The Japanese handwriting guides use the separate `hiragana` and `katakana`
data sets from [hy2k/kana-svg-data](https://github.com/hy2k/kana-svg-data),
which packages the Japanese kana files from AnimCJK. The source is licensed
under the GNU Lesser General Public License, version 3.0.

`scripts/bundle-japanese-kana-strokes.ps1` downloads the exact 46 basic kana
for each script. The site loads only these bundled local files; it never
chooses an equivalent-looking character from the other script.
