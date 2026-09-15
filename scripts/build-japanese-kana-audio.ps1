param(
  [string]$OutputRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $OutputRoot 'assets/pronunciation/japanese/kana-audio-manifest.json') -Raw | ConvertFrom-Json
$output = Join-Path $OutputRoot 'assets/pronunciation/japanese/kana'
$download = Join-Path ([IO.Path]::GetTempPath()) 'crowstudies-hakatanoshio117117'
New-Item -ItemType Directory -Force -Path $output,$download | Out-Null
$vowels = @{ a=@(0.099,0.265); i=@(0.000,0.160); u=@(0.000,0.168); e=@(0.047,0.208); o=@(0.000,0.156) }
$culture = [cultureinfo]::InvariantCulture

foreach ($item in $manifest) {
  $source = Join-Path $download $item.originalFilename
  $url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + [uri]::EscapeDataString($item.originalFilename)
  curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 60 --user-agent 'CrowStudies educational audio bundler' --output $source $url
  if ($LASTEXITCODE -ne 0) { throw "Could not download $($item.originalFilename)" }
  $target = Join-Path $output ($item.romaji + '.mp3')
  if ($vowels.ContainsKey($item.romaji)) {
    $cut = $vowels[$item.romaji]; $length = $cut[1] - $cut[0]; $fade = $length - .005
    $filter = 'atrim=start={0}:end={1},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.005,afade=t=out:st={2}:d=0.005,loudnorm=I=-18:TP=-1.5:LRA=7' -f $cut[0].ToString('0.000',$culture),$cut[1].ToString('0.000',$culture),$fade.ToString('0.000',$culture)
  } else {
    $filter = 'silenceremove=start_periods=1:start_duration=0.03:start_threshold=-60dB,loudnorm=I=-18:TP=-1.5:LRA=7'
  }
  ffmpeg -y -v error -i $source -af $filter -codec:a libmp3lame -q:a 4 $target
  if ($LASTEXITCODE -ne 0) { throw "Could not encode $($item.romaji)" }
}
