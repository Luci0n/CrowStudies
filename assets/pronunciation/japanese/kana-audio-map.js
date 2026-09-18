/* Public-domain Hakatanoshio117117 Japanese kana recordings.  Base kana are
   deliberately strict-local: a missing bundled asset must never turn into TTS. */
(function(){
  var kanaToRomaji = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','を':'wo','ん':'n'
  };
  /* Katakana read exactly as their hiragana partners do, so they share the
     recordings rather than doubling them. Each basic kana sits 0x60 above its
     hiragana in Unicode - あ to ア, ん to ン - so the table is derived rather
     than typed out a second time and left to drift. Without this the katakana
     cards matched nothing here and fell through to the browser voice. */
  Object.keys(kanaToRomaji).forEach(function(hira){
    var kata = String.fromCharCode(hira.charCodeAt(0) + 0x60);
    if (!kanaToRomaji[kata]) kanaToRomaji[kata] = kanaToRomaji[hira];
  });
  window.CrowJapaneseKanaAudio = kanaToRomaji;
  window.CrowLocalAudio = window.CrowLocalAudio || {};
  window.CrowLocalAudio['ja-JP'] = function(text){
    var romaji = kanaToRomaji[String(text || '').charAt(0)];
    return romaji ? {
      src: '../assets/pronunciation/japanese/kana/' + romaji + '.mp3?v=friend-reading-katakana-20260918',
      strict: true
    } : '';
  };
}());
