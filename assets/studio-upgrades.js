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
async function snapshot(){
  const id=projectId();if(!id)return;
  const label=window.prompt('Name this checkpoint','Before changes');if(label===null)return;
  const projects=await cloud().listProjects(), project=projects.filter(x=>x.id===id)[0];const blocks=await cloud().listBlocks(id);
  await cloud().saveHistory(id,label,{project:{title:project.title,sections:project.sections||[]},blocks});
  closeOverlay();showHistory();
}
async function duplicateRevision(revision){
  const c=cloud(), data=revision.snapshot;if(!data)return;
  const id=await c.createProject((data.project&&data.project.title||'Project')+' copy');
  await c.saveProject(id,{title:(data.project&&data.project.title||'Project')+' copy',sections:data.project.sections||[]});
  await Promise.all((data.blocks||[]).map((b,i)=>{const copy=Object.assign({},b,{id:'restored-'+Date.now()+'-'+i,order:Date.now()+i});return c.saveBlock(id,copy.id,copy);}));
  closeOverlay();refreshProject(id);
}
async function showHistory(){
  const id=projectId();if(!id)return;
  const box=overlay('Version history','<div class="upgrade-history-actions"><button class="btn sm" data-checkpoint>Save checkpoint</button></div><div class="upgrade-history-list"></div>');
  box.querySelector('[data-checkpoint]').onclick=snapshot;
  const list=await cloud().listHistory(id), holder=box.querySelector('.upgrade-history-list');
  if(!list.length)holder.innerHTML='<p class="upgrade-copy">No checkpoints yet. Save one before a major change, then you can safely make a copy of it later.</p>';
  list.forEach(item=>{const row=document.createElement('div');row.className='upgrade-history';row.innerHTML='<b>'+esc(item.label)+'</b><span>by @'+esc(item.author||'someone')+' · '+new Date(item.createdMs||0).toLocaleString()+'</span><button class="btn ghost sm">Duplicate this version</button>';row.querySelector('button').onclick=()=>duplicateRevision(item);holder.appendChild(row);});
}
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
function start(){if(!root){return;}observer=new MutationObserver(()=>setTimeout(decorate,0));observer.observe(root,{childList:true,subtree:true});setInterval(decorate,700);decorate();}
start();
