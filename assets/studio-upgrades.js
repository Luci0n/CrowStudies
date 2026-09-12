const root=document.querySelector('#studio');
const cloud=()=>window.CrowCloud;
const upgradeMark='data-studio-upgrade';
let observer;
let commentProjectId='';
let commentCounts=new Map();
let stopCommentWatch=function(){};

function syncCommentBadges(){
  const id=projectId();
  if(id===commentProjectId)return;
  stopCommentWatch();commentProjectId=id;commentCounts=new Map();stopCommentWatch=function(){};
  if(!id)return;
  import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js').then(function(api){
    if(commentProjectId!==id)return;
    const comments=api.collection(api.getFirestore(),'projects',id,'comments');
    stopCommentWatch=api.onSnapshot(api.query(comments,api.orderBy('createdMs','asc')),function(snapshot){
      if(commentProjectId!==id)return;
      commentCounts=new Map();
      snapshot.forEach(function(entry){const blockId=entry.data().blockId;if(blockId)commentCounts.set(blockId,(commentCounts.get(blockId)||0)+1);});
      updateCommentBadges();
    });
  }).catch(function(){});
}

function esc(v){const n=document.createElement('div');n.textContent=v||'';return n.innerHTML;}
function projectId(){const active=root&&root.querySelector('.project-item.active');return active&&active.dataset.project||'';}
function closeOverlay(){document.querySelectorAll('.studio-upgrade-overlay').forEach(n=>n.remove());}
function overlay(title,body){
  closeOverlay();
  const shade=document.createElement('div');shade.className='studio-upgrade-overlay';
  const box=document.createElement('section');box.className='studio-upgrade-dialog';
  box.innerHTML='<button class="upgrade-close" aria-label="Close">×</button><h2>'+esc(title)+'</h2>';
  if(typeof body==='string')box.insertAdjacentHTML('beforeend',body);else box.appendChild(body);
  shade.appendChild(box);document.body.appendChild(shade);
  box.querySelector('.upgrade-close').onclick=closeOverlay;shade.onclick=e=>{if(e.target===shade)closeOverlay();};
  return box;
}
function refreshProject(id){
  const start=Date.now();
  (function look(){
    const target=root.querySelector('[data-project="'+id+'"]');
    if(target){target.click();return;}
    if(Date.now()-start<2500)setTimeout(look,80);
  })();
}
async function showTasks(){
  const id=projectId();if(!id)return;
  const list=await cloud().listBlocks(id);const entries=[];
  list.forEach(block=>(block.items||[]).forEach((item,index)=>entries.push({block,index,item})));
  const box=overlay('Project tasks','<p class="upgrade-copy">'+entries.length+' tasks across this project.</p><div class="upgrade-task-list"></div>');
  const holder=box.querySelector('.upgrade-task-list');
  if(!entries.length)holder.innerHTML='<p class="upgrade-copy">Add a Task list block to collect work here.</p>';
  entries.forEach(row=>{const label=document.createElement('label');label.className='upgrade-task';label.innerHTML='<input type="checkbox" '+(row.item.done?'checked':'')+'><span>'+esc(row.item.text||'Untitled task')+'</span><small>'+esc(row.block.title||'Untitled block')+'</small>';label.querySelector('input').onchange=async e=>{const items=(row.block.items||[]).map(x=>Object.assign({},x));items[row.index].done=e.target.checked;row.block.items=items;await cloud().patchBlock(id,row.block.id,{items});};holder.appendChild(label);});
}
/* Studio's own prompts live inside its closure, so the panel builds its two
   on the same overlay it uses for everything else. */
function ask(title, body, confirmLabel){
  return new Promise(function(settle){
    const box=overlay(title,'<p class="upgrade-copy">'+esc(body).replace(/\n/g,'<br>')+'</p>'
      +'<div class="upgrade-history-actions"><button class="btn ghost sm" data-no>Cancel</button><button class="btn sm" data-yes>'+esc(confirmLabel||'Continue')+'</button></div>');
    let answered=false;
    const finish=function(value){ if(answered)return; answered=true; closeOverlay(); settle(value); };
    box.querySelector('[data-yes]').onclick=function(){ finish(true); };
    box.querySelector('[data-no]').onclick=function(){ finish(false); };
    box.querySelector('.upgrade-close').onclick=function(){ finish(false); };
  });
}
function tell(title, body){ return ask(title, body, 'OK'); }
/* ------------------------------------------------------------------ history
   A project keeps two kinds of version. One you ask for by name, before a
   change you are not sure about. The other Studio takes on its own once you
   have edited and then stopped for a while, so there is something to go back
   to even when nobody thought to save one.

   Opening a version never touches the project. It puts Studio into a reading
   state over the old copy, with live updates paused and editing refused, and
   only Restore writes anything back. */

const QUIET_MS = 45000;      /* a pause this long ends a stretch of editing */
const LONGEST_MS = 600000;   /* and a stretch never runs longer than this  */
const KEEP_AUTOMATIC = 25;   /* named versions are kept for good           */

let dirtySince = 0, lastEdit = 0, savingVersion = false;
let lastSavedMark = '', autosaveProject = '';

function studio(){ return window.CrowStudio; }
function versionMark(data){
  if(!data)return '';
  const tidy = (block) => {
    const copy = Object.assign({}, block);
    delete copy.updatedAt; delete copy.updatedBy; delete copy.pending;
    return copy;
  };
  try{
    return JSON.stringify({
      title:(data.project&&data.project.title)||'',
      sections:(data.project&&data.project.sections)||[],
      blocks:(data.blocks||[]).map(tidy)
    });
  }catch(error){ return ''; }
}
function markDirty(){
  const id = studio() && studio().projectId();
  if(!id || (studio().previewing && studio().previewing()))return;
  if(id !== autosaveProject){ autosaveProject = id; lastSavedMark = ''; dirtySince = 0; }
  lastEdit = Date.now();
  if(!dirtySince) dirtySince = lastEdit;
}
/* Every write Studio makes passes through the cloud object, so marking an edit
   here catches all of them at once, including ones added later. */
function watchEdits(){
  const c = cloud();
  if(!c || c.__historyWatched)return;
  c.__historyWatched = true;
  ['saveBlock','patchBlock','deleteBlock','saveProject'].forEach(function(name){
    const original = c[name];
    if(typeof original !== 'function')return;
    c[name] = function(){ markDirty(); return original.apply(this, arguments); };
  });
}
async function autosaveTick(){
  if(savingVersion || !dirtySince)return;
  const s = studio();
  if(!s || !s.projectId() || !s.canEdit() || (s.previewing && s.previewing()))return;
  const now = Date.now();
  const settled = now - lastEdit >= QUIET_MS;
  const overdue = now - dirtySince >= LONGEST_MS;
  if(!settled && !overdue)return;
  const data = s.snapshot();
  const mark = versionMark(data);
  /* Undoing an edit back to where it started leaves nothing worth keeping. */
  if(!data || !mark || mark === lastSavedMark){ dirtySince = 0; return; }
  savingVersion = true;
  try{
    const id = s.projectId();
    await cloud().saveHistory(id, 'Automatic version', data, 'auto');
    lastSavedMark = mark; dirtySince = 0;
    await pruneAutomatic(id);
  }catch(error){
    /* An offline moment should not cost the next attempt. */
    dirtySince = now - LONGEST_MS + 60000;
  }finally{ savingVersion = false; }
}
/* Named versions are kept because somebody chose them. Automatic ones are a
   safety net, so only the most recent stretch of them is worth the room. */
async function pruneAutomatic(projectId){
  try{
    const list = await cloud().listHistory(projectId);
    const spare = list.filter(x => (x.kind || 'named') === 'auto').slice(KEEP_AUTOMATIC);
    for(const old of spare) await cloud().removeHistory(projectId, old.id);
  }catch(error){}
}

function whenSaved(ms){
  const then = new Date(ms || 0), now = new Date();
  const time = then.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  if(then.toDateString() === now.toDateString())return 'Today, ' + time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if(then.toDateString() === yesterday.toDateString())return 'Yesterday, ' + time;
  return then.toLocaleDateString([], { month:'short', day:'numeric', year:then.getFullYear()===now.getFullYear()?undefined:'numeric' }) + ', ' + time;
}

async function saveCheckpoint(){
  const s = studio(), id = s && s.projectId();
  if(!id)return;
  const label = window.prompt('Name this version', 'Before changes');
  if(label === null)return;
  const data = s.snapshot();
  await cloud().saveHistory(id, label.trim() || 'Checkpoint', data, 'named');
  lastSavedMark = versionMark(data); dirtySince = 0;
  showHistory();
}
async function nameVersion(entry){
  const id = studio() && studio().projectId();
  if(!id)return;
  const label = window.prompt('Name this version', 'Version from ' + whenSaved(entry.createdMs));
  if(label === null)return;
  try{ await cloud().nameHistory(id, entry.id, label.trim() || 'Named version'); }
  catch(error){ await tell('This version could not be named', 'Firebase turned the change down. The history rules in your console need to allow an owner or editor to change a version’s label.'); return; }
  showHistory();
}
/* Reading a version is a separate request, because the list deliberately does
   not carry every copy of the project with it. */
async function openVersion(entry){
  const id = studio() && studio().projectId();
  if(!id)return;
  const full = entry.snapshot ? entry : await cloud().readHistory(id, entry.id);
  if(!full || !full.snapshot){ await tell('This version could not be opened', 'Its contents are missing.'); return; }
  closeOverlay();
  studio().openPreview(full);
}
async function duplicateRevision(revision){
  const c = cloud(), data = revision.snapshot;
  if(!data)return;
  const title = (data.project && data.project.title || 'Project') + ' copy';
  const id = await c.createProject(title);
  await c.saveProject(id, { title:title, sections:(data.project && data.project.sections) || [] });
  await Promise.all((data.blocks || []).map((b, i) => {
    const copy = Object.assign({}, b, { id:'restored-' + Date.now() + '-' + i, order:Date.now() + i });
    return c.saveBlock(id, copy.id, copy);
  }));
  closeOverlay();
  refreshProject(id);
}
/* Restoring is the one thing here that changes the project everyone shares, so
   it says plainly what it will do, and takes a version of the present first. */
async function restoreVersion(entry){
  const s = studio(), id = s && s.projectId();
  if(!id)return;
  const full = entry.snapshot ? entry : await cloud().readHistory(id, entry.id);
  if(!full || !full.snapshot)return;
  const when = whenSaved(full.createdMs);
  const ok = await ask('Restore this version?',
    'The project goes back to how it was on ' + when + '. Work added since then is removed, for everyone this project is shared with.\n\n'
    + 'A version of the project as it stands right now is saved first, so this can be undone from the same list.',
    'Restore this version');
  if(!ok)return;
  const before = s.snapshot();
  try{ await cloud().saveHistory(id, 'Before restoring “' + (full.label || 'a version') + '”', before, 'named'); }catch(error){}
  closeOverlay();
  await s.restore(full.snapshot);
  if(s.previewing())s.closePreview(); else await s.reload(id);
}

function versionRowHTML(entry, automatic){
  const who = entry.author ? 'by @' + esc(entry.author) : '';
  const label = automatic ? whenSaved(entry.createdMs) : esc(entry.label || 'Named version');
  const note = automatic ? who : whenSaved(entry.createdMs) + (who ? ' · ' + who : '');
  return '<div class="upgrade-history-line"><b>' + label + '</b>'
    + (automatic ? '' : '<em class="version-tag">named</em>')
    + '<span>' + note + '</span></div>'
    + '<div class="version-actions">'
    + '<button class="btn ghost sm" data-act="view">View</button>'
    + '<button class="btn ghost sm" data-act="restore">Restore</button>'
    + (automatic ? '<button class="btn ghost sm" data-act="name">Name this version</button>' : '')
    + '<button class="btn ghost sm" data-act="copy">Make a copy</button>'
    + '</div>';
}
async function showHistory(){
  const s = studio(), id = s && s.projectId();
  if(!id)return;
  const box = overlay('Version history',
    '<p class="upgrade-copy">Studio saves a version on its own after you edit and then stop for a while. Save one by name before anything you might want to come back from.</p>'
    + '<div class="upgrade-history-actions"><button class="btn sm" data-checkpoint>Name a version of right now</button></div>'
    + '<div class="upgrade-history-list"><p class="upgrade-copy">Loading…</p></div>');
  box.querySelector('[data-checkpoint]').onclick = saveCheckpoint;
  const holder = box.querySelector('.upgrade-history-list');
  let list = [];
  try{ list = await cloud().listHistory(id); }
  catch(error){ holder.innerHTML = '<p class="upgrade-copy">This project’s history could not be read.</p>'; return; }
  if(!list.length){
    holder.innerHTML = '<p class="upgrade-copy">No versions yet. One is saved automatically the first time you edit this project and then pause.</p>';
    return;
  }
  holder.innerHTML = '';
  list.forEach(function(entry){
    const automatic = (entry.kind || 'named') === 'auto';
    const row = document.createElement('div');
    row.className = 'upgrade-history' + (automatic ? ' is-auto' : '');
    row.innerHTML = versionRowHTML(entry, automatic);
    row.querySelectorAll('[data-act]').forEach(function(button){
      button.onclick = function(){
        const act = button.dataset.act;
        if(act === 'view')return openVersion(entry);
        if(act === 'restore')return restoreVersion(entry);
        if(act === 'name')return nameVersion(entry);
        return duplicateRevision(entry);
      };
    });
    holder.appendChild(row);
  });
}
/* The Restore button on the preview bar comes back through here, so the
   warning is worded the same way wherever it is reached from. */
window.CrowStudioHistory = {
  confirmRestore:function(){
    const s = studio();
    if(!s || !s.previewing())return;
    restoreVersion(s.previewEntry());
  },
  open:showHistory
};

async function showComments(blockId){
  const id=projectId();if(!id)return;
  const box=overlay('Comments','<div class="upgrade-comments"></div><form class="upgrade-comment-form"><textarea placeholder="Write a comment. Use @username to mention someone."></textarea><button class="btn sm">Comment</button></form>');
  const holder=box.querySelector('.upgrade-comments');
  async function render(){
    const comments=await cloud().listComments(id,blockId);
    holder.innerHTML=comments.length?comments.map(x=>'<article><b>@'+esc(x.author||'someone')+'</b><p>'+esc(x.text).replace(/(^|\s)@([a-z0-9_]{3,20})/gi,'$1<span class="upgrade-mention">@$2</span>')+'</p></article>').join(''):'<p class="upgrade-copy">No comments yet.</p>';
  }
  await render();
  box.querySelector('form').onsubmit=async e=>{e.preventDefault();const field=e.currentTarget.querySelector('textarea');if(!field.value.trim())return;await cloud().addComment(id,blockId,field.value);field.value='';await render();updateCommentBadges();};
}
function slashMenu(body){
  document.querySelectorAll('.upgrade-slash').forEach(x=>x.remove());
  const menu=document.createElement('div');menu.className='upgrade-slash';
  const commands=[
    ['Heading 1','<h1>Heading</h1>'],['Heading 2','<h2>Heading</h2>'],['Bullet list','<ul><li>List item</li></ul>'],['Divider','<hr>'],['Callout','<blockquote>Important note</blockquote>']
  ];
  commands.forEach(([name,html])=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>{body.focus();document.execCommand('insertHTML',false,html);body.dispatchEvent(new Event('input',{bubbles:true}));menu.remove();};menu.appendChild(b);});
  const rect=body.getBoundingClientRect();menu.style.left=Math.max(12,rect.left)+'px';menu.style.top=(rect.top+12)+'px';document.body.appendChild(menu);
}
function bindSlash(){
  root.querySelectorAll('[data-body]').forEach(body=>{
    if(body.dataset.slashBound)return;body.dataset.slashBound='1';
    body.addEventListener('keydown',e=>{if(body.dataset.collabActive==='true')return;if(e.key==='/'&&!e.ctrlKey&&!e.metaKey){const text=window.getSelection&&window.getSelection().toString();if(!text){e.preventDefault();slashMenu(body);}}});
  });
}
async function updateCommentBadge(button){
  const id=projectId(),blockId=button.closest('[data-block]')&&button.closest('[data-block]').dataset.block;if(!id||!blockId)return;
  if(id===commentProjectId){
    const count=commentCounts.get(blockId)||0;button.textContent=count?'Comments · '+count:'Comment';button.classList.toggle('has-comments',count>0);return;
  }
  try{const count=(await cloud().listComments(id,blockId)).length;button.textContent=count?'Comments · '+count:'Comment';button.classList.toggle('has-comments',count>0);}catch(e){}
}
function updateCommentBadges(){root.querySelectorAll('.upgrade-comment').forEach(updateCommentBadge);}
function bindComment(card){
  if(card.querySelector('.upgrade-comment'))return;
  const kicker=card.querySelector('.block-kicker');if(!kicker)return;
  const b=document.createElement('button');b.className='upgrade-comment';b.type='button';b.textContent='Comment';b.onclick=()=>showComments(card.dataset.block);kicker.appendChild(b);updateCommentBadge(b);
}
function decorate(){
  if(!root||!cloud()||!cloud().user)return;
  syncCommentBadges();
  const actions=root.querySelector('.project-actions');
  if(actions&&!actions.querySelector('[data-upgrade-tasks]')){
    [['Tasks',showTasks,'data-upgrade-tasks'],['History',showHistory,'data-upgrade-history']].forEach(([label,fn,attr])=>{const b=document.createElement('button');b.className='btn ghost sm';b.textContent=label;b.setAttribute(attr,'');b.onclick=fn;actions.insertBefore(b,actions.firstChild);});
  }
  root.querySelectorAll('[data-block]').forEach(card=>{bindComment(card);});
  bindSlash();
}
window.CrowStudioUpgrades={decorate:function(){ decorate(); }};
function start(){if(!root){return;}observer=new MutationObserver(()=>setTimeout(decorate,0));observer.observe(root,{childList:true,subtree:true});setInterval(decorate,700);setInterval(function(){watchEdits();autosaveTick();},5000);decorate();}
start();
