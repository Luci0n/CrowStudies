/* ============================================================
   CrowStudies shared course engine.

   A course hands over a list of units. Each unit holds ordered
   steps; a step is one idea to teach plus the question generators
   that drill it. The engine builds the session queue, renders the
   screens, keeps attempts and progress, and stores results per course.

   CrowQuiz({
     course:  'music',                    // storage namespace
     title:   'Patchbay',
     tagline: 'Music theory for people who make beats',
     logo:    '<svg>…</svg>',
     units:   [ { id, title, blurb, color, icon, hint, steps:[…] } ],
     backLink:{ href:'../lessons/', label:'All lessons' },
     types:   { myType: function(area, q, api){ … } },   // custom questions
     sounds:  { correct, wrong, fanfare },
     extra:   { label:'Lessons', title:'Lessons', build:function(el){ … } },
     perStep: 2, reviewQs: 2, mixedCount: 10, hearts: 3
   }).start();

   A step:  { title, body, demo:function(){return node}, gens:[fn] }
   A question generator returns:
     { type:'mcq',  tag, headline, sub?, choices:[…], correctIndex, explain }
     { type:'type', tag, headline, sub?, answer, alts?, placeholder?, explain }
     { type:'<custom>', … }  handled by config.types
   Custom renderers call api.finish(true|false) when the answer lands.
   ============================================================ */

/* Pronunciation is deliberately one utterance at a time. Calling speak directly
   after cancel can leave Firefox (and some Chromium builds) reading its old
   queue as well as the new letter. Waiting one event turn makes the cancel
   reliable and selecting a voice after voiceschanged covers late-loading voices. */
(function(){
  var synth = window.speechSynthesis, pending = 0, timer = null, voices = [];
  function refreshVoices(){ voices = synth && synth.getVoices ? synth.getVoices() : []; }
  if (synth){ refreshVoices(); synth.onvoiceschanged = refreshVoices; }
  function fallbackAudio(text, lang){
    /* Speech voices are supplied by the operating system. This fallback keeps
       Russian and Japanese playable in browsers where that voice is absent. */
    try{
      var audio = new Audio('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl='
        + encodeURIComponent(String(lang || '').split('-')[0]) + '&q=' + encodeURIComponent(text));
      audio.play().catch(function(){});
    }catch(e){}
  }
  window.CrowSpeak = function(text, lang, rate){
    if (!synth || !('SpeechSynthesisUtterance' in window)){ fallbackAudio(text, lang); return false; }
    var request = ++pending;
    clearTimeout(timer);
    synth.cancel();
    timer = setTimeout(function(){
      if (request !== pending) return;
      refreshVoices();
      var utterance = new SpeechSynthesisUtterance(text);
      var wanted = String(lang || '').toLowerCase(), primary = wanted.split('-')[0];
      var voice = voices.filter(function(v){ return String(v.lang || '').toLowerCase() === wanted; })[0]
        || voices.filter(function(v){ return String(v.lang || '').toLowerCase().split('-')[0] === primary; })[0];
      /* Do not let a random English system voice attempt Cyrillic or kana.
         It sounds broken even though the browser technically made a sound. */
      if (!voice){ fallbackAudio(text, lang); return; }
      utterance.lang = lang;
      utterance.rate = rate || 0.82;
      if (voice) utterance.voice = voice;
      utterance.onerror = function(){ if (request === pending) fallbackAudio(text, lang); };
      synth.speak(utterance);
      /* Firefox can remain paused after a cancelled utterance. */
      setTimeout(function(){ if (request === pending && synth.paused) synth.resume(); }, 120);
    }, 45);
    return true;
  };
}());

function CrowQuiz(config){
  'use strict';

  var PER_STEP   = config.perStep   || 2;
  var REVIEW_QS  = config.reviewQs  != null ? config.reviewQs : 2;
  var MIXED      = config.mixedCount || 10;
  var HEARTS     = config.hearts    || 3;
  var UNITS      = config.units;
  var TYPES      = config.types || {};
  var SOUNDS     = config.sounds || {};
  var STORE      = 'crowstudies_' + config.course;
  var HOME_TABS  = config.homeTabs || null;
  var UNIT_PRACTICE = config.unitPractice !== false;
  var activeHomeTab = HOME_TABS && HOME_TABS.length ? HOME_TABS[0].id : null;

  var PRAISE = ['Nice', 'Exactly', "That's it", 'Clean', 'Locked in', 'Correct'];

  /* ---------- storage ---------- */
  /* Guest progress stays on this device. Account progress is kept in a
     separate browser cache and synced to Firebase, so signing out never makes
     an account's work look like anonymous progress. */
  var GUEST_STORE = STORE + ':guest';
  function blankSave(){ return { xp:0, bestRun:0, sessions:0, units:{}, cards:{} }; }
  function loadSave(key, legacy){
    try{
      var raw=localStorage.getItem(key);
      if(raw){ var parsed=JSON.parse(raw); if(parsed && typeof parsed.xp === 'number') return parsed; }
      if(legacy){ var old=JSON.parse(localStorage.getItem(STORE)); if(old && typeof old.xp === 'number') return old; }
    }catch(e){}
    return blankSave();
  }
  function accountStore(uid){ return STORE + ':account:' + uid; }
  function mergeSave(local, remote){
    var merged = { xp:Math.max(local.xp||0,remote.xp||0), bestRun:Math.max(local.bestRun||0,remote.bestRun||0), sessions:Math.max(local.sessions||0,remote.sessions||0), units:{}, cards:{} };
    var ids = Object.keys(local.units||{}).concat(Object.keys(remote.units||{}).filter(function(id){ return !(local.units||{})[id]; }));
    ids.forEach(function(id){
      var a=(local.units||{})[id]||{}, b=(remote.units||{})[id]||{};
      merged.units[id]={ done:Math.max(a.done||0,b.done||0), best:Math.max(a.best||0,b.best||0), total:Math.max(a.total||0,b.total||0) };
    });
    var cardIds=Object.keys(local.cards||{}).concat(Object.keys(remote.cards||{}).filter(function(id){ return !(local.cards||{})[id]; }));
    cardIds.forEach(function(id){
      var a=(local.cards||{})[id], b=(remote.cards||{})[id];
      if (!a) merged.cards[id]=b;
      else if (!b) merged.cards[id]=a;
      else merged.cards[id]=(a.updatedAt||0) >= (b.updatedAt||0) ? a : b;
    });
    return merged;
  }
  function persist(){
    var user=window.CrowCloud&&window.CrowCloud.user;
    try{ localStorage.setItem(user ? accountStore(user.uid) : GUEST_STORE, JSON.stringify(save)); }catch(e){}
    if(user) window.CrowCloud.saveCourse(config.course, save).catch(function(){});
  }
  var save = loadSave(GUEST_STORE);
  var cloudLoadedFor = null;
  function loadCloudProgress(){
    if (!window.CrowCloud || !window.CrowCloud.user || cloudLoadedFor === window.CrowCloud.user.uid) return;
    var user=window.CrowCloud.user;
    cloudLoadedFor = user.uid;
    var local=loadSave(accountStore(user.uid), true);
    window.CrowCloud.loadCourse(config.course).then(function(remote){
      save = remote ? mergeSave(local, remote) : local;
      persist();
      if (dom.path) renderHome();
    }).catch(function(){
      save=local;
      if(dom.path)renderHome();
    });
  }
  function loadGuestProgress(){
    cloudLoadedFor=null;
    save=loadSave(GUEST_STORE);
    if(dom.path)renderHome();
  }

  /* ---------- helpers ---------- */
  function randInt(n){ return Math.floor(Math.random()*n); }
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function unitById(id){
    for (var i=0;i<UNITS.length;i++){ if (UNITS[i].id===id) return UNITS[i]; }
    return UNITS[0];
  }
  function unitGens(u){
    return u.steps.reduce(function(a,s){ return a.concat(s.gens); }, []);
  }
  function buildLessonReference(root){
    root.innerHTML='';
    UNITS.forEach(function(u){
      var section=el('section','teach');
      section.appendChild(el('h2',null,u.title));
      if (u.blurb) section.appendChild(el('p','body',u.blurb));
      u.steps.filter(function(step){ return step.title; }).forEach(function(step){
        var lesson=el('div','practice-preview');
        lesson.appendChild(el('b',null,step.title));
        lesson.appendChild(el('p','body',step.body));
        if (step.demo) lesson.appendChild(step.demo());
        section.appendChild(lesson);
      });
      root.appendChild(section);
    });
  }
  var EXTRA = config.extra || { label:'Lessons', title:'Lessons', build:buildLessonReference, asTab:true };
  /* FSRS-6 models each card's stability, difficulty, and retrievability. The
     official scheduler uses a learner's growing review history rather than a
     fixed ease multiplier. We retain its complete card state in each course
     save, so account sync carries the model between devices. */
  var MINUTE = 60 * 1000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
  function stableQuestionKey(q){
    return [q.type || '', q.tag || '', q.headlineHtml || q.headline || '', q.sub || '', q.answer || '', q.hanzi || ''].join('~');
  }
  function cardId(unitId, key){ return unitId + '::' + key; }
  function dueCards(unitId){
    var now=Date.now(), cards=save.cards || {};
    return Object.keys(cards).map(function(id){ return cards[id]; }).filter(function(card){
      return card && (!unitId || card.unit === unitId) && card.due <= now;
    }).sort(function(a,b){ return (a.due||0) - (b.due||0); });
  }
  function reviewableCards(){
    var cards=save.cards || {};
    return Object.keys(cards).map(function(id){ return cards[id]; }).filter(Boolean).sort(function(a,b){
      return (a.due||0) - (b.due||0);
    });
  }
  function fsrsScheduler(){
    var retention=window.CrowCloud&&window.CrowCloud.reviewRetention ? window.CrowCloud.reviewRetention() : 0.9;
    return window.FSRS && window.FSRS.fsrs ? window.FSRS.fsrs({request_retention:retention,maximum_interval:36500,enable_fuzz:false,enable_short_term:true,learning_steps:['10m'],relearning_steps:['10m']}) : null;
  }
  function fsrsCard(card, now){
    var lib=window.FSRS, stored=card && card.fsrs;
    if (!stored) {
      if (card && card.reps){
        return {due:new Date(card.due||now.getTime()),stability:Math.max(.1,(card.interval||DAY)/DAY),difficulty:5,elapsed_days:0,scheduled_days:Math.max(1,Math.round((card.interval||DAY)/DAY)),reps:card.reps||0,lapses:card.lapses||0,learning_steps:0,state:2,last_review:new Date(card.updatedAt||now.getTime())};
      }
      return lib.createEmptyCard(now);
    }
    return {due:new Date(stored.due),stability:stored.stability,difficulty:stored.difficulty,elapsed_days:stored.elapsed_days||0,scheduled_days:stored.scheduled_days||0,reps:stored.reps||0,lapses:stored.lapses||0,learning_steps:stored.learning_steps||0,state:stored.state,last_review:stored.last_review?new Date(stored.last_review):undefined};
  }
  function ratingNumber(grade){ return {again:1,hard:2,good:3,easy:4}[grade] || 3; }
  function applyFsrs(card, next, now){
    card.fsrs={due:next.due.getTime(),stability:next.stability,difficulty:next.difficulty,elapsed_days:next.elapsed_days,scheduled_days:next.scheduled_days,reps:next.reps,lapses:next.lapses,learning_steps:next.learning_steps,state:next.state,last_review:next.last_review&&next.last_review.getTime()};
    card.reps=next.reps; card.lapses=next.lapses; card.interval=Math.max(0,next.due.getTime()-now.getTime()); card.due=next.due.getTime(); card.updatedAt=now.getTime();
  }
  function scheduleCard(unitId, q, grade, hinted){
    if (!save.cards) save.cards={};
    var key=stableQuestionKey(q), id=cardId(unitId,key), now=new Date(), card=save.cards[id] || {id:id,unit:unitId,key:key};
    var scheduler=fsrsScheduler();
    if (!scheduler) return;
    var result=scheduler.next(fsrsCard(card,now),now, ratingNumber(hinted?'again':grade)), next=result.card;
    applyFsrs(card,next,now);
    card.history=(card.history||[]).concat({at:now.getTime(),rating:ratingNumber(hinted?'again':grade),elapsedDays:result.log.elapsed_days,state:result.log.state}).slice(-200);
    save.cards[id]=card;
  }
  function ratingPreview(unitId, q, grade){
    var scheduler=fsrsScheduler(), id=cardId(unitId,stableQuestionKey(q)), card=(save.cards||{})[id] || {id:id,unit:unitId,key:stableQuestionKey(q)}, now=new Date();
    if (!scheduler) return '—';
    var due=scheduler.repeat(fsrsCard(card,now),now)[ratingNumber(grade)].card.due.getTime(), interval=Math.max(0,due-now.getTime());
    if (interval < HOUR) return Math.max(1,Math.round(interval/MINUTE))+'m';
    return interval < DAY ? Math.round(interval/HOUR)+'h' : Math.max(1,Math.round(interval/DAY))+'d';
  }
  function dueLabel(card){
    var ms=Math.max(0,(card.due||0)-Date.now());
    if (!ms) return 'Review due';
    if (ms < DAY) return 'Review later today';
    return 'Review in '+Math.ceil(ms/DAY)+'d';
  }

  var state = { session:null, question:null, locked:false, hinted:false, lastQuestionKey:'' };
  var dom = {};

  /* ---------- skeleton ---------- */
  function buildSkeleton(root){
    root.innerHTML = ''
      + '<div class="app">'
      +   '<section class="screen active" data-screen="home">'
      +     (config.backLink ? '<div class="coursecrumb"><a class="crumblink" href="' + config.backLink.href + '"><span aria-hidden="true">&larr;</span>' + (config.backLink.label || 'Back') + '</a></div>' : '')
      +     '<div class="coursehero">'
      +       '<span class="logo" aria-hidden="true">' + (config.logo||'') + '</span>'
      +       '<div><h1></h1><p></p></div>'
      +     '</div>'
      +     '<div class="course-tabs" data-f="courseTabs" hidden></div>'
      +     '<div class="statrow">'
      +       '<div class="stat streak"><b data-f="run">0</b><span>Best run</span></div>'
      +       '<div class="stat acc"><b data-f="sessions">0</b><span>Sessions</span></div>'
      +     '</div>'
      +     '<div class="pathhead"><h2>Practice</h2><button class="btn ghost sm" data-f="reviewDue">Review cards</button></div>'
      +     '<div class="home-tabs" data-f="homeTabs"></div>'
      +     '<div class="path" data-f="path"></div>'
      +   '</section>'
      +   '<section class="screen" data-screen="session">'
      +     '<div class="topbar">'
      +       '<button class="iconbtn" data-f="quit" aria-label="Leave this session">&times;</button>'
      +       '<div class="progresstrack"><div class="progressfill" data-f="progress"></div></div>'
      +       '<div class="attempts" data-f="hearts" aria-label="Attempts remaining"></div>'
      +     '</div>'
      +     '<div class="review-mode-help" data-f="reviewModeHelp" hidden><button type="button" data-f="reviewInfoOpen"><i aria-hidden="true">?</i> Review mode</button></div>'
      +     '<div data-f="question"></div>'
      +     '<div class="hintrow"><button class="hintbtn" data-f="hint">Show me a hint</button></div>'
      +   '</section>'
      +   '<section class="screen" data-screen="results">'
      +     '<div class="result">'
      +       '<svg class="prize" viewBox="0 0 120 120" aria-hidden="true">'
      +         '<circle cx="60" cy="60" r="52" fill="var(--gold)"/>'
      +         '<circle cx="60" cy="60" r="40" fill="var(--gold-shelf)" opacity=".25"/>'
      +         '<path d="M45 40h30v26a15 15 0 0 1-30 0z" fill="#fff"/>'
      +         '<rect x="52" y="70" width="16" height="14" rx="3" fill="#fff"/>'
      +         '<rect x="42" y="82" width="36" height="8" rx="4" fill="#fff"/>'
      +       '</svg>'
      +       '<h2 data-f="resTitle">Unit cleared</h2>'
      +       '<p data-f="resSub"></p>'
      +       '<div class="resgrid">'
      +         '<div class="stat acc"><b data-f="resAcc">0%</b><span>Accuracy</span></div>'
      +         '<div class="stat streak"><b data-f="resRun">0</b><span>Best run</span></div>'
      +       '</div>'
      +       '<button class="btn wide" data-f="again">Practice again</button>'
      +       '<div style="height:12px"></div>'
      +       '<button class="btn ghost wide" data-f="home">Back to units</button>'
      +     '</div>'
      +   '</section>'
      +   '<section class="screen" data-screen="extra">'
      +     (config.backLink ? '<div class="coursecrumb" data-f="extraCrumb" hidden><a class="crumblink" href="' + config.backLink.href + '"><span aria-hidden="true">&larr;</span>' + (config.backLink.label || 'Back') + '</a></div>' : '')
      +     '<div class="coursehero" data-f="extraHero" hidden>'
      +       '<span class="logo" data-f="extraLogo" aria-hidden="true"></span>'
      +       '<div><h1 data-f="extraCourseTitle"></h1><p data-f="extraCourseTagline"></p></div>'
      +     '</div>'
      +     '<div class="course-tabs" data-f="extraCourseTabs" hidden></div>'
      +     '<div class="topbar" data-f="extraTopbar">'
      +       '<button class="iconbtn" data-f="extraBack" aria-label="Back to units">&larr;</button>'
      +       '<h2 style="font-size:24px;flex:1" data-f="extraTitle"></h2>'
      +     '</div>'
      +     '<div data-f="extraBody"></div>'
      +   '</section>'
      + '</div>'
      + '<div class="sheet" data-f="sheet">'
      +   '<div class="sheet-inner">'
      +     '<div class="verdict"><span class="vmark" data-f="vmark">&#10003;</span><h3 data-f="vtext"></h3></div>'
      +     '<p class="explain" data-f="vexplain"></p>'
      +     '<div class="rating" data-f="rating" hidden></div>'
      +     '<button class="btn good wide" data-f="continue">Continue</button>'
      +   '</div>'
      + '</div>'
      + '<div class="backdrop" data-f="modal" hidden>'
      +   '<div class="modal"><h3>Hint</h3><p data-f="modalText"></p>'
      +   '<button class="btn wide" data-f="modalClose">Got it</button></div>'
      + '</div>'
      + '<div class="backdrop" data-f="reviewInfo" hidden>'
      +   '<div class="modal review-info"><div class="review-info-mark" aria-hidden="true">↻</div><h3>Review mode</h3>'
      +   '<p>These cards return at the moment you are most likely to need them. Try to recall before looking at the answer, then rate the effort honestly.</p>'
      +   '<div class="review-info-ratings"><span><b>Again</b> I missed it</span><span><b>Hard</b> I got it, barely</span><span><b>Good</b> I recalled it</span><span><b>Easy</b> Instant recall</span></div>'
      +   '<p class="review-info-note">Your choice sets the next review time. The schedule adapts to your history and retention setting.</p>'
      +   '<button class="btn wide" data-f="reviewInfoClose">Got it</button></div>'
      + '</div>';

    root.querySelectorAll('[data-f]').forEach(function(n){ dom[n.dataset.f] = n; });
    root.querySelectorAll('[data-screen]').forEach(function(n){ dom['screen_'+n.dataset.screen] = n; });

    root.querySelector('.coursehero h1').textContent = config.title || '';
    root.querySelector('.coursehero p').textContent = config.tagline || '';

    if (EXTRA){
      var b = el('button', 'btn ghost sm', EXTRA.label);
      function syncCourseTabs(screen){
        [dom.courseTabs,dom.extraCourseTabs].forEach(function(tabs){
          if (!tabs || tabs.hidden) return;
          Array.prototype.forEach.call(tabs.children, function(tab){ tab.classList.toggle('active', tab.dataset.screen === screen); });
        });
      }
      dom.syncCourseTabs = syncCourseTabs;
      function openExtra(){
        if (!dom.extraBody.dataset.built){
          EXTRA.build(dom.extraBody);
          dom.extraBody.dataset.built = '1';
        }
        if (EXTRA.asTab) syncCourseTabs('extra');
        showScreen('extra');
      }
      b.onclick = openExtra;
      if (EXTRA.asTab){
        dom.extraHero.hidden = false;
        if (dom.extraCrumb) dom.extraCrumb.hidden = false;
        dom.extraTopbar.hidden = true;
        dom.extraLogo.innerHTML = config.logo || '';
        dom.extraCourseTitle.textContent = config.title || '';
        dom.extraCourseTagline.textContent = config.tagline || '';
        [dom.courseTabs,dom.extraCourseTabs].forEach(function(tabs){
          tabs.hidden = false;
          var practiceTab = el('button', 'course-tab active', 'Practice');
          practiceTab.type = 'button'; practiceTab.dataset.screen = 'home';
          practiceTab.onclick = function(){ if (dom.screen_home.classList.contains('active')) return; renderHome(); showScreen('home'); };
          var lessonTab = el('button', 'course-tab', EXTRA.label);
          lessonTab.type = 'button'; lessonTab.dataset.screen = 'extra'; lessonTab.onclick = function(){ if (dom.screen_extra.classList.contains('active')) return; openExtra(); };
          tabs.appendChild(practiceTab); tabs.appendChild(lessonTab);
        });
      } else {
        root.querySelector('.pathhead').appendChild(b);
      }
      dom.extraTitle.textContent = EXTRA.title || EXTRA.label;
    }

    if (HOME_TABS){
      HOME_TABS.forEach(function(tab){
        var b = el('button', 'btn ghost sm', tab.label);
        b.onclick = function(){ if (activeHomeTab === tab.id) return; activeHomeTab = tab.id; renderHome(); };
        b.dataset.homeTab = tab.id;
        dom.homeTabs.appendChild(b);
      });
    } else {
      dom.homeTabs.hidden = true;
    }
  }

  function inSession(){ return !!dom.screen_session && dom.screen_session.classList.contains('active'); }

  function showScreen(name){
    if (name !== 'session') hideSheet();
    ['home','session','results','extra'].forEach(function(s){
      dom['screen_'+s].classList.toggle('active', s===name);
    });
    window.scrollTo(0,0);
  }

  /* ---------- home ---------- */
  function renderHome(){
    if (dom.syncCourseTabs) dom.syncCourseTabs('home');
    dom.run.textContent = save.bestRun;
    dom.sessions.textContent = save.sessions;
    var due=dueCards(), available=reviewableCards();
    dom.reviewDue.disabled=!available.length;
    dom.reviewDue.textContent=due.length ? 'Review '+due.length+' due' : (available.length ? 'Review '+available.length+' cards' : 'Review cards');
    dom.reviewDue.title=available.length ? 'Practice previously seen cards; due cards appear first.' : 'Answer practice questions first to create review cards.';

    var visibleUnits = HOME_TABS
      ? UNITS.filter(function(u){ return (u.homeTab || HOME_TABS[0].id) === activeHomeTab; })
      : UNITS;
    dom.path.classList.remove('is-changing');
    void dom.path.offsetWidth;
    dom.path.classList.add('is-changing');
    dom.path.innerHTML = '';
    if (HOME_TABS){
      Array.prototype.forEach.call(dom.homeTabs.children, function(b){
        b.classList.toggle('active', b.dataset.homeTab === activeHomeTab);
      });
    }
    var next = -1;
    visibleUnits.forEach(function(u, i){
      var r = save.units[u.id];
      if (next < 0 && !(r && r.done)) next = i;
    });
    if (next < 0) next = 0;

    visibleUnits.forEach(function(u, i){
      var rec = save.units[u.id] || { done:0, best:0, total:0 };
      var unitDue=dueCards(u.id);
      var row = el('div', 'unitrow');
      var card = el('article', 'unit' + (rec.done>0 ? ' done' : (i===next ? ' next' : '')));
      card.style.setProperty('--u', u.color);

      var disc = el('span', 'disc');
      disc.innerHTML = rec.done>0
        ? '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : u.icon;

      var txt = el('span', 'utext');
      txt.appendChild(el('b', null, u.title));
      var lessons = u.steps.filter(function(s){ return s.title; }).length;
      txt.appendChild(el('span', null, unitDue.length
        ? unitDue.length+' review '+(unitDue.length===1?'card':'cards')+' due'
        : (rec.done>0
        ? 'Best ' + rec.best + '/' + (rec.total||'?') + ' · ' + rec.done + (rec.done===1?' run':' runs')
        : (lessons ? lessons + (lessons===1?' lesson · ':' lessons · ') + u.blurb : u.blurb))));
      if (rec.done>0){
        var meter = el('span', 'meter');
        var fill = el('i');
        fill.style.width = Math.round((rec.best / Math.max(1, rec.total||1)) * 100) + '%';
        meter.appendChild(fill);
        txt.appendChild(meter);
      }

      var actions = el('div', 'unit-actions');
      /* A unit's Learn route is deliberately separate from its drill route.
         The former plays its authored material in order; the latter is only
         randomized recall questions. Review-only units have no lesson route. */
      if (lessons){
        var learn = el('button', 'btn sm unit-learn', 'Learn');
        learn.type = 'button';
        learn.onclick = function(){ startSession(u.id, null, true); };
        actions.appendChild(learn);
      }
      var practice = el('button', 'btn sm unit-practice', 'Practice');
      practice.type = 'button';
      practice.onclick = function(){ startSession(u.id); };
      actions.appendChild(practice);
      card.appendChild(disc);
      card.appendChild(txt);
      card.appendChild(actions);
      row.appendChild(card);
      dom.path.appendChild(row);
    });
  }

  /* ---------- session ---------- */
  function buildQueue(u, reviewCards, lessonMode){
    var queue = [];
    var lastGen = null;
    var seenQuestionKeys = {};
    function addQuestion(pool, targetKey, sourceUnit){
      if (!pool || !pool.length) return;
      var choices = pool.filter(function(gen){ return gen !== lastGen; });
      var gens = choices.length ? choices : pool;
      var candidate = null, key = '';
      /* A generator may choose randomly from a small pool. Generate first,
         then keep only a prompt the learner has not already seen this run. */
      for (var attempt=0; attempt<(targetKey ? 2400 : Math.max(12, gens.length*4)); attempt++){
        var gen = gens[randInt(gens.length)];
        var q = gen();
        var qKey = stableQuestionKey(q);
        if ((!targetKey || qKey===targetKey) && !seenQuestionKeys[qKey]){
          candidate = q; key = qKey; lastGen = gen; break;
        }
      }
      if (!candidate) return;
      seenQuestionKeys[key] = true;
      queue.push({ kind:'q', question:candidate, unit:sourceUnit || u.id, cardKey:key });
    }
    if (reviewCards){
      reviewCards.forEach(function(card){ addQuestion(unitGens(unitById(card.unit)), card.key, card.unit); });
      return queue;
    }
    if (UNIT_PRACTICE && !lessonMode){
      var practicePool=unitGens(u);
      var practiceCount=u.questionCount != null ? u.questionCount : (config.unitPracticeCount || 6);
      for (var p=0;p<practiceCount;p++) addQuestion(practicePool);
      return queue;
    }
    var teaching = u.steps.filter(function(s){ return s.title; }).length > 0;
    if (!teaching){
      var pool = unitGens(u);
      var questionCount = u.questionCount != null ? u.questionCount : MIXED;
      for (var i=0;i<questionCount;i++) addQuestion(pool);
      return queue;
    }
    u.steps.forEach(function(step){
      if (step.title) queue.push({ kind:'teach', step:step });
      // `0` is meaningful for a teaching-only step (for example, a mode
      // selector). Only fall back when the course did not specify a count.
      var n = step.questions != null ? step.questions : PER_STEP;
      for (var i=0;i<n;i++) addQuestion(step.gens);
    });
    var all = unitGens(u);
    for (var r=0;r<REVIEW_QS;r++) addQuestion(all);
    return queue;
  }

  function startSession(unitId, reviewCards, lessonMode){
    var queue = buildQueue(unitById(unitId), reviewCards, lessonMode);
    state.session = {
      unit:unitId, queue:queue, review:!!reviewCards, lesson:!!lessonMode, index:0,
      totalQ: queue.filter(function(it){ return it.kind==='q'; }).length,
      answered:0, correct:0, run:0, bestRun:0, hearts:HEARTS, xp:0
    };
    state.lastQuestionKey = '';
    dom.reviewModeHelp.hidden=!reviewCards;
    showScreen('session');
    renderHearts();
    nextItem();
  }

  function renderHearts(){
    dom.hearts.innerHTML = '';
    for (var i=0;i<HEARTS;i++){
      var marker = document.createElement('i');
      if (i >= state.session.hearts) marker.className = 'spent';
      dom.hearts.appendChild(marker);
    }
    dom.hearts.setAttribute('aria-label', state.session.hearts + ' attempts remaining');
  }
  function renderProgress(){
    var s = state.session;
    dom.progress.style.width = (s.index / s.queue.length) * 100 + '%';
  }

  function nextItem(){
    hideSheet();
    renderProgress();
    var item = state.session.queue[state.session.index];
    dom.hint.parentNode.hidden = (item.kind === 'teach');
    state.locked = false;
    if (item.kind === 'teach'){
      state.question = null;
      renderTeach(item.step);
      return;
    }
    state.question = item.question;
    state.questionUnit = item.unit || state.session.unit;
    state.hinted = false;
    renderQuestion();
  }

  /* Retriggers the entrance on an element whose contents were replaced. */
  function freshen(node){
    if (!node) return;
    node.classList.remove('is-fresh');
    void node.offsetWidth;
    node.classList.add('is-fresh');
  }

  function renderTeach(step){
    var area = dom.question;
    area.innerHTML = '';
    var box = el('div', 'teach');
    box.appendChild(el('div', 'newchip', 'New idea'));
    box.appendChild(el('h2', null, step.title));
    box.appendChild(el('p', 'body', step.body));
    if (step.demo) box.appendChild(step.demo());
    /* A preview can be useful for authored workspace lessons, but course
       practice text often contains a worked example. Let a course opt out so
       teaching never gives away the next answer. */
    if (step.practice && config.showPracticePreview !== false){
      var preview = el('div', 'practice-preview');
      preview.innerHTML = '<b>Next practice:</b> ' + step.practice;
      box.appendChild(preview);
    }
    var go = el('button', 'btn wide', 'Got it');
    go.onclick = advance;
    box.appendChild(go);
    area.appendChild(box);
    freshen(area);
    go.focus({ preventScroll:true });
  }

  function renderQuestion(){
    var q = state.question;
    var area = dom.question;
    area.innerHTML = '';

    freshen(area);
    if (q.tag) area.appendChild(el('div', 'qtag', q.tag));
    var head = el('h2', 'qhead');
    if (q.headlineHtml) head.innerHTML = q.headlineHtml; else head.textContent = q.headline;
    area.appendChild(head);
    if (q.sub) area.appendChild(el('p', 'qsub', q.sub));
    if (q.speech && window.CrowSpeak){
      var hear = el('button', 'speakbtn', 'Hear it');
      hear.type = 'button';
      hear.setAttribute('aria-label', 'Hear the pronunciation again');
      hear.onclick = function(){ window.CrowSpeak(q.speech.text, q.speech.lang, q.speech.rate); };
      area.appendChild(hear);
    }

    if (q.type === 'mcq'){
      var longest = Math.max.apply(null, q.choices.map(function(c){ return String(c).length; }));
      var wrap = el('div', 'choices' + (longest > 14 ? ' tall' : ''));
      q.choices.forEach(function(text, idx){
        var b = el('button', 'choice');
        if (q.bigChoices) b.style.cssText = 'font-size:38px;font-family:"Noto Sans JP","Space Grotesk",sans-serif;padding:18px';
        b.textContent = text;
        b.onclick = function(){
          if (state.locked) return;
          var all = area.querySelectorAll('.choice');
          Array.prototype.forEach.call(all, function(x){ x.disabled = true; });
          all[q.correctIndex].classList.add('correct');
          if (idx !== q.correctIndex) b.classList.add('wrong');
          finish(idx === q.correctIndex);
        };
        wrap.appendChild(b);
      });
      area.appendChild(wrap);
    } else if (q.type === 'type'){
      var row = el('div', 'typerow');
      var input = document.createElement('input');
      input.className = 'typein';
      input.type = 'text';
      input.autocapitalize = 'off';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = q.placeholder || 'Type your answer';
      var check = el('button', 'btn', 'Check');
      function submit(){
        if (state.locked) return;
        var v = input.value.trim().toLowerCase();
        if (!v) return;
        var ok = (q.alts || [q.answer]).some(function(a){ return a.toLowerCase() === v; });
        input.classList.add(ok ? 'correct' : 'wrong');
        input.disabled = true;
        check.disabled = true;
        finish(ok);
      }
      check.onclick = submit;
      input.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); submit(); } });
      row.appendChild(input);
      row.appendChild(check);
      area.appendChild(row);
      setTimeout(function(){ input.focus({ preventScroll:true }); }, 30);
    } else if (TYPES[q.type]){
      TYPES[q.type](area, q, { finish:finish });
    }
  }

  function finish(success){
    /* A custom type can report an answer after the learner has already left. */
    if (state.locked || !state.session || !inSession()) return;
    state.locked = true;
    var s = state.session;
    var counted = !state.hinted;
    s.answered++;
    /* Practice creates a card from the observed answer. Review is different:
       it waits for the learner's own recall rating before scheduling. */
    if (!s.review){
      scheduleCard(state.questionUnit || s.unit, state.question, success ? 'good' : 'again', state.hinted);
      persist();
    }

    if (success){
      if (counted){
        s.correct++;
        s.run++;
        s.bestRun = Math.max(s.bestRun, s.run);
      }
      if (SOUNDS.correct) SOUNDS.correct();
    } else {
      s.run = 0;
      s.hearts--;
      renderHearts();
      if (SOUNDS.wrong) SOUNDS.wrong();
    }

    dom.sheet.className = 'sheet up ' + (state.hinted ? '' : (success ? 'right' : 'wrong'));
    dom.vmark.textContent = success ? '✓' : '✕';
    dom.vtext.textContent = state.hinted
      ? 'Hint used. No score this time.'
      : (success ? PRAISE[randInt(PRAISE.length)] : 'Not this time');
    dom.vexplain.textContent = state.question.explain || '';
    dom.rating.hidden = !s.review;
    dom['continue'].hidden = s.review;
    if (s.review){
      dom.rating.innerHTML = '';
      ['again','hard','good','easy'].forEach(function(grade){
        var labels={again:'Again',hard:'Hard',good:'Good',easy:'Easy'};
        var button=el('button','btn sm rating-'+grade,labels[grade]+' · '+ratingPreview(state.questionUnit || s.unit,state.question,grade));
        button.type='button';
        button.onclick=function(){ rateReview(grade); };
        dom.rating.appendChild(button);
      });
      dom.rating.querySelector('button').focus({ preventScroll:true });
      return;
    }
    dom['continue'].className = 'btn wide ' + (success && counted ? 'good' : (success ? '' : 'bad'));
    dom['continue'].textContent = (s.hearts <= 0 || s.index + 1 >= s.queue.length) ? 'See results' : 'Continue';
    dom['continue'].focus({ preventScroll:true });
  }

  function rateReview(grade){
    if (!state.session || !state.session.review || !state.locked) return;
    scheduleCard(state.questionUnit || state.session.unit, state.question, grade, state.hinted);
    persist();
    advance();
  }

  function hideSheet(){
    if (dom.sheet) dom.sheet.className = 'sheet';
    if (dom.rating) { dom.rating.hidden=true; dom.rating.innerHTML=''; }
    if (dom['continue']) dom['continue'].hidden=false;
  }

  function advance(){
    var s = state.session;
    s.index++;
    if (s.hearts <= 0 || s.index >= s.queue.length){ endSession(); return; }
    nextItem();
  }

  function endSession(){
    var s = state.session;
    s.index = s.queue.length;
    renderProgress();
    hideSheet();

    save.sessions++;
    save.bestRun = Math.max(save.bestRun, s.bestRun);
    var rec = save.units[s.unit] || { done:0, best:0, total:s.totalQ };
    rec.done++;
    rec.total = s.totalQ;
    rec.best = Math.max(rec.best, s.correct);
    save.units[s.unit] = rec;
    persist();

    var ranOut = s.hearts <= 0;
    dom.resTitle.textContent = ranOut ? 'Out of hearts' : (s.review ? 'Review complete' : 'Unit cleared');
    dom.resSub.textContent = ranOut
      ? 'You got ' + s.correct + ' right before the third slip. Run it back.'
      : (s.review ? 'You reviewed '+s.totalQ+' '+(s.totalQ===1?'card':'cards')+'.' : (s.lesson ? 'Lesson complete: ' : '') + unitById(s.unit).title + ': ' + s.correct + ' of ' + s.totalQ + ' correct.');
    dom.resAcc.textContent = Math.round((s.correct / Math.max(1, s.answered)) * 100) + '%';
    dom.resRun.textContent = s.bestRun;
    showScreen('results');
    if (!ranOut && SOUNDS.fanfare && s.correct >= Math.ceil(s.totalQ * 0.8)) SOUNDS.fanfare();
  }

  function startReview(){
    var cards=reviewableCards().slice(0,20);
    if (cards.length) startSession(cards[0].unit, cards);
  }
  function openReview(){
    startReview();
  }

  /* ---------- wiring ---------- */
  function start(rootSelector){
    var root = document.querySelector(rootSelector || '#app');
    buildSkeleton(root);

    dom.quit.onclick = function(){ hideSheet(); renderHome(); showScreen('home'); };
    dom.home.onclick = function(){ renderHome(); showScreen('home'); };
    dom.again.onclick = function(){
      if (state.session && state.session.review){
        var cards=reviewableCards();
        if (cards.length) startSession(cards[0].unit, cards.slice(0, Math.min(20,cards.length)));
        else { renderHome(); showScreen('home'); }
      } else startSession(state.session ? state.session.unit : UNITS[0].id);
    };
    dom.reviewDue.onclick = openReview;
    dom.reviewInfoOpen.onclick = function(){ dom.reviewInfo.hidden=false; dom.reviewInfoClose.focus({preventScroll:true}); };
    dom.reviewInfoClose.onclick = function(){ dom.reviewInfo.hidden=true; };
    dom.reviewInfo.onclick = function(e){ if(e.target===dom.reviewInfo) dom.reviewInfo.hidden=true; };
    dom['continue'].onclick = advance;
    dom.extraBack.onclick = function(){ renderHome(); showScreen('home'); };
    dom.hint.onclick = function(){
      if (state.locked || !state.question) return;
      state.hinted = true;
      dom.modalText.textContent = unitById(state.session.unit).hint;
      dom.modal.hidden = false;
    };
    dom.modalClose.onclick = function(){ dom.modal.hidden = true; };
    dom.modal.onclick = function(e){ if (e.target === dom.modal) dom.modal.hidden = true; };

    document.addEventListener('keydown', function(e){
      if (e.key === 'Enter' && state.locked && dom.sheet.classList.contains('up') && !state.session.review){
        e.preventDefault(); advance();
      }
      if (e.key === 'Escape' && !dom.modal.hidden) dom.modal.hidden = true;
    });

    renderHome();
    window.addEventListener('crow-auth-state', function(event){
      if (event.detail && event.detail.user) loadCloudProgress();
      else loadGuestProgress();
    });
    loadCloudProgress();
    return api;
  }

  var api = { start:start, renderHome:renderHome, save:save };
  return api;
}
