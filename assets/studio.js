(function(){
  'use strict';
  var root=document.querySelector('#studio');
  var activeProject=null, activeSection='all', activePage='all', openSectionMenu='', blocks=[], saveTimers={}, savePatches={}, studioError='', view='project', readOnly=false, loadingProject=false;
  /* Looking at an old version is a place Studio stands in, not a copy it
     makes. The live project is set aside in liveState, the watchers are let
     go so nothing arrives while you read, and every write is refused. */
  var preview=null, liveState=null;
  var SIDE_KEY='crowstudies:studio:projects-open';
  function narrow(){ try{ return window.matchMedia('(max-width:780px)').matches; }catch(error){ return false; } }
  var sideOpen=narrow()?false:(function(){ try{ return localStorage.getItem(SIDE_KEY)!=='0'; }catch(error){ return true; } }());
  /* Folding the list away is not worth a redraw: it would close every shared
     note on the page and take the cursor with it. */
  function setSide(open){
    sideOpen=open;
    if(!narrow()){ try{ localStorage.setItem(SIDE_KEY,open?'1':'0'); }catch(error){} }
    root.classList.toggle('side-closed',!open);
    var side=root.querySelector('.studio-side');
    if(side)side.classList.toggle('is-open',open);
    var scrim=root.querySelector('.side-scrim');
    if(scrim)scrim.hidden=!open;
    root.querySelectorAll('[data-side-toggle]').forEach(function(button){ button.setAttribute('aria-expanded',open?'true':'false'); });
  }
  function sideToggleHTML(where){
    /* The handle keeps still. In the sidebar it is the first thing in the
       header, and when the column folds down to a rail it is all that is left
       there — same corner, same size, so it is where you left it either way.
       The copy in the main column is for a phone, where the sidebar is a
       drawer that takes its own handle off the screen with it. */
    return '<div class="studio-crumb'+(where?' '+where:'')+'"><button type="button" class="side-toggle" data-side-toggle aria-expanded="'+(sideOpen?'true':'false')+'" title="Show or hide your projects"><span class="side-toggle-mark" aria-hidden="true"></span><span class="side-toggle-label">Projects</span></button></div>';
  }
  try{
    window.matchMedia('(max-width:780px)').addEventListener('change',function(event){
      /* A drawer that survived a rotation would be sitting on top of the work. */
      if(event.matches&&sideOpen)setSide(false);
      else if(!event.matches){ try{ setSide(localStorage.getItem(SIDE_KEY)!=='0'); }catch(error){ setSide(true); } }
    });
  }catch(error){}
  function previewing(){ return !!preview; }
  /* Escapes quotes too: these strings are also dropped into attribute values. */
  function esc(value){ var n=document.createElement('div'); n.textContent=value||''; return n.innerHTML.replace(/"/g,'&quot;'); }
  function id(){ return (crypto.randomUUID && crypto.randomUUID()) || ('block-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
  function cleanHTML(html){
    var template=document.createElement('template'); template.innerHTML=html||'';
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(function(node){ node.remove(); });
    template.content.querySelectorAll('*').forEach(function(node){
      Array.from(node.attributes).forEach(function(attr){
        var name=attr.name.toLowerCase();
        var okay=(node.tagName==='A' && ['href','target'].indexOf(name)>=0)
          /* Column widths live on the table's colgroup, so keep that one style. */
          || (name==='style' && ['COL','TH','TD'].indexOf(node.tagName)>=0);
        if (!okay) node.removeAttribute(attr.name);
      });
      if (node.hasAttribute('style')){
        var width=/width\s*:\s*([\d.]+(?:%|px))/i.exec(node.getAttribute('style')||'');
        if (width) node.setAttribute('style','width:'+width[1]); else node.removeAttribute('style');
      }
      if (node.tagName==='A' && !/^https?:|^mailto:/i.test(node.getAttribute('href')||'')) node.removeAttribute('href');
    });
    tidyHeadings(template.content);
    return template.innerHTML;
  }
  var HEADINGS='h1,h2,h3,h4,h5,h6';
  var BLOCK_LEVEL=/^(P|H[1-6]|LI|UL|OL|TABLE|THEAD|TBODY|TR|TD|TH|BLOCKQUOTE|DIV|PRE)$/;
  function unwrap(node){
    var parent=node.parentNode; if(!parent)return;
    while(node.firstChild) parent.insertBefore(node.firstChild,node);
    parent.removeChild(node);
  }
  /* A heading may only hold inline content. Browsers happily nest a heading
     inside another heading (or wrap a whole list in one) when a heading is
     applied twice, which is what made the text grow each time. Dissolve any
     heading that wraps block-level content and the structure stays flat. */
  function tidyHeadings(container){
    for(var pass=0;pass<12;pass++){
      var offenders=Array.prototype.filter.call(container.querySelectorAll(HEADINGS),function(node){
        return !!node.querySelector(HEADINGS+',ul,ol,li,table,p,div,blockquote');
      });
      if(!offenders.length)return;
      offenders.forEach(unwrap);
    }
  }
  /* Loose text sitting straight in the editor has no block to convert, so give
     it a paragraph before a heading button touches it. */
  function ensureParagraphs(host){
    var group=null;
    Array.prototype.slice.call(host.childNodes).forEach(function(node){
      if(node.nodeType===1&&BLOCK_LEVEL.test(node.tagName)){ group=null; return; }
      if(node.nodeType===3&&!node.nodeValue.trim()) return;
      if(!group){ group=document.createElement('p'); host.insertBefore(group,node); }
      group.appendChild(node);
    });
  }
  function nearestBlock(node, host){
    while(node&&node!==host){
      if(node.nodeType===1&&/^(P|H[1-6]|LI|BLOCKQUOTE|DIV)$/.test(node.tagName))return node;
      node=node.parentNode;
    }
    return null;
  }
  function selectedBlocks(host){
    var selection=window.getSelection();
    if(!selection||!selection.rangeCount||!host.contains(selection.anchorNode))return [];
    var range=selection.getRangeAt(0);
    var found=Array.prototype.filter.call(host.querySelectorAll('p,'+HEADINGS+',li,blockquote,div'),function(node){
      try{ return range.intersectsNode(node); }catch(error){ return false; }
    });
    found=found.filter(function(node){
      return !found.some(function(other){ return other!==node&&node.contains(other); });
    });
    /* A caret resting on the editor itself intersects nothing, so fall back to
       the block it sits in or beside. */
    if(!found.length){
      var start=range.startContainer;
      if(start===host)start=host.childNodes[Math.min(range.startOffset,Math.max(0,host.childNodes.length-1))];
      var block=nearestBlock(start,host);
      if(block)found=[block];
    }
    return found;
  }
  /* A list item cannot change tag, so carry the heading inside it instead and
     replace whatever level was there before rather than stacking a new one. */
  function setItemLevel(item, tag){
    Array.prototype.slice.call(item.children).forEach(function(child){ if(/^H[1-6]$/.test(child.tagName)) unwrap(child); });
    if(tag==='P')return item;
    var heading=document.createElement(tag);
    while(item.firstChild) heading.appendChild(item.firstChild);
    item.appendChild(heading);
    return heading;
  }
  function caretToEnd(node){
    var selection=window.getSelection(), range=document.createRange();
    range.selectNodeContents(node); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
  }
  /* Replaces the block the caret sits in instead of wrapping it, so pressing
     H1 twice keeps one H1 and switching to P clears the heading entirely. */
  function applyBlockTag(host, tag){
    ensureParagraphs(host);
    var targets=selectedBlocks(host);
    if(!targets.length)return;
    var last=null;
    targets.forEach(function(node){
      /* Anything living inside a list item is levelled through the item, so a
         heading is swapped or removed rather than left behind. */
      var item=node.tagName==='LI'?node:(node.parentNode&&node.parentNode.tagName==='LI'?node.parentNode:null);
      if(item){ last=setItemLevel(item,tag)||last; return; }
      if(node.tagName===tag){ last=node; return; }
      var replacement=document.createElement(tag);
      while(node.firstChild) replacement.appendChild(node.firstChild);
      node.parentNode.replaceChild(replacement,node);
      last=replacement;
    });
    tidyHeadings(host);
    if(last&&host.contains(last)) caretToEnd(last);
  }
  function cloud(){ return window.CrowCloud; }
  var FILE_FORMAT=1;
  async function notify(title, body){
    if (window.CrowUI) return window.CrowUI.notice({title:title,body:body});
    alert(title+'\n\n'+body);
  }
  function safeName(text){ return (String(text||'crowstudies').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'crowstudies'); }
  function downloadJSON(name, payload){
    var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    var url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url; link.download=name+'.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  }
  /* Reads one .json the person picks. Resolves null when they cancel. */
  function readJSONFile(){
    return new Promise(function(resolve){
      var input=document.createElement('input');
      input.type='file'; input.accept='application/json,.json'; input.style.display='none';
      input.onchange=function(){
        var file=input.files&&input.files[0];
        input.remove();
        if(!file)return resolve(null);
        var reader=new FileReader();
        reader.onload=function(){ try{ resolve(JSON.parse(String(reader.result))); }catch(error){ resolve({__broken:true}); } };
        reader.onerror=function(){ resolve({__broken:true}); };
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
    });
  }
  function lessonPayload(block){
    var meta=lessonMeta(block);
    return { crowstudies:'lesson', version:FILE_FORMAT, exportedAt:new Date().toISOString(),
      lesson:{ title:block.title||'', section:meta.section, blurb:meta.blurb, icon:meta.icon, color:meta.color, hint:meta.hint, steps:lessonSteps(block) } };
  }
  function applyLessonPayload(block, lesson){
    block.title=String(lesson.title||block.title||'');
    block.lessonSection=String(lesson.section||'');
    block.lessonBlurb=String(lesson.blurb||'');
    block.lessonIcon=String(lesson.icon||'✦');
    block.lessonColor=/^#[0-9a-f]{6}$/i.test(lesson.color||'')?lesson.color:LESSON_DEFAULT_COLOR;
    block.lessonHint=String(lesson.hint||'');
    block.steps=(Array.isArray(lesson.steps)&&lesson.steps.length?lesson.steps:[{kind:'explain'}]).map(normalizeStep);
  }
  function projectPayload(){
    return { crowstudies:'project', version:FILE_FORMAT, exportedAt:new Date().toISOString(),
      project:{ title:activeProject.title, sections:activeProject.sections||[] },
      blocks:blocks.map(function(block){ var copy=Object.assign({},block); delete copy.pending; return copy; }),
      rows:(function(){ var out={}; blocks.filter(isDatabase).forEach(function(block){ out[block.id]=dbRowsOf(block.id).map(function(row){ return Object.assign({},row); }); }); return out; })() };
  }
  /* Everything comes back with fresh ids so an import never collides with a
     project that is already here, including one exported from this account. */
  async function restoreProject(payload){
    var sectionIds={}, pageIds={};
    var sections=(payload.project&&Array.isArray(payload.project.sections)?payload.project.sections:[]).map(function(section){
      var fresh=id();
      sectionIds[section.id]=fresh;
      return { id:fresh, title:String(section.title||'Section'), locked:!!section.locked,
        pages:(Array.isArray(section.pages)?section.pages:[]).map(function(page){
          var pageId=id();
          pageIds[page.id]=pageId;
          return { id:pageId, title:String(page.title||'Page') };
        }) };
    });
    var title=String((payload.project&&payload.project.title)||'Imported project');
    var projectId=await cloud().createProject(title);
    await cloud().saveProject(projectId,{ title:title, sections:sections });
    var stamp=Date.now(), incoming=Array.isArray(payload.blocks)?payload.blocks:[];
    for(var i=0;i<incoming.length;i++){
      var block=normalizeBlock(incoming[i]);
      block.id=id();
      block.sectionId=sectionIds[incoming[i].sectionId]||'';
      block.pageId=pageIds[incoming[i].pageId]||'';
      block.order=stamp+i;
      delete block.pending;
      await cloud().saveBlock(projectId,block.id,block);
      var carried=(payload.rows||{})[incoming[i].id];
      if(Array.isArray(carried)){
        for(var r=0;r<carried.length;r++){
          await cloud().saveRow(projectId,block.id,id(),{ order:carried[r].order||(stamp+r), values:carried[r].values||{} });
        }
      }
    }
    return { projectId:projectId, title:title, count:incoming.length };
  }
  /* The project every workspace starts with. It explains Studio using the very
     blocks it is describing, so reading it and taking it apart teach the same
     thing. Ids here are placeholders; importing rewrites them. */
  function exampleProject(){
    var start='s-start', kinds='s-kinds', more='s-more', order=0;
    function block(extra){ order++; return Object.assign({id:'x'+order,order:order,items:[],title:'',body:'',sectionId:'',pageId:''},extra); }
    return {
      crowstudies:'project', version:FILE_FORMAT,
      project:{
        title:'Welcome to Studio',
        sections:[
          {id:start,title:'Start here',pages:[],locked:false},
          {id:kinds,title:'The blocks',pages:[],locked:false},
          {id:more,title:'Going further',pages:[],locked:false}
        ]
      },
      blocks:[
        block({type:'note',sectionId:start,title:'What this is',body:'<p>Studio is your private workspace. Nobody else can see it, and it follows you to any device you sign in on.</p><p>A <b>project</b> holds <b>blocks</b>. Blocks are the notes, lists, tables, and lessons below. Group them into <b>sections</b> using the row of buttons above, and give a section <b>pages</b> from its cog menu when one section is not enough.</p><p>Everything saves as you type. There is no save button.</p>'}),
        block({type:'tasks',sectionId:start,title:'Five things to try',items:[
          {text:'Add a block from the row at the bottom',done:false},
          {text:'Type a title on it',done:false},
          {text:'Drag it somewhere else by the ⠿ grip',done:false},
          {text:'Make a section with + Section',done:false},
          {text:'Press View project, then come back',done:false}
        ]}),
        block({type:'note',sectionId:start,title:'Editing and reading',body:'<p><b>Edit project</b> is where you build: every field is open, blocks can be dragged, and the controls are all there.</p><p><b>View project</b> is how the project reads once it is built. Editing controls step out of the way, empty image blocks are left out, and a practice lesson shows what it covers instead of how it was made.</p><p>The button sits at the top right. Try it now and then come back.</p>'}),
        block({type:'note',sectionId:kinds,title:'Note',body:'<p>A note is for writing. Click into it and a small toolbar appears: <b>B</b>, <i>I</i>, a bullet list, and H1 to H3 for headings.</p><p>Headings work on the line the cursor is in. Pressing H1 twice leaves one heading, and P clears it again.</p>'}),
        block({type:'table',sectionId:kinds,title:'Table',body:'<table><colgroup><col style="width:34.000%"><col style="width:33.000%"><col style="width:33.000%"></colgroup><tbody><tr><th>Do this</th><th>To get</th><th>Note</th></tr><tr><td>Drag across cells</td><td>A block of cells selected</td><td>Shift-click works too</td></tr><tr><td>+ Row, + Column</td><td>Added next to the selection</td><td>− removes the selection</td></tr><tr><td>Drag a divider</td><td>A wider or narrower column</td><td>Between the header cells</td></tr></tbody></table>'}),
        block({type:'lesson',sectionId:kinds,title:'How a practice lesson works',
          lessonSection:'Lessons',lessonBlurb:'teach something, then ask about it',lessonIcon:'✦',lessonColor:'#7657f7',
          lessonHint:'Each step teaches first and asks afterwards. Teach only steps have no question at all.',
          steps:[
            {kind:'explain',title:'A lesson is a run of steps',body:'Each step teaches one idea, then asks about it. Press Practice this lesson and you get the same screens the courses on this site use.',practice:'',prompt:'',answer:'',options:[]},
            {kind:'choice',title:'Steps come in three kinds',body:'Teach only says something and moves on. Multiple choice offers answers to pick from. Free response asks you to type one.',practice:'Name the kind that has no question.',prompt:'Which kind of step asks nothing?',answer:'Teach only',options:['Teach only','Multiple choice','Free response'],},
            {kind:'free',title:'Building one',body:'In Edit mode this block shows a list of steps beside one open step. Click a step to open it, drag a step to reorder it, and use Lesson details for the section, summary, icon, color, and the hint the practice screen offers.',practice:'Say where the hint comes from.',prompt:'Which panel holds the lesson hint?',answer:'Lesson details',options:[]}
          ]}),
        block({type:'image',sectionId:kinds,title:'Image',imageUrl:'../assets/crow.svg',body:''}),
        block({type:'milestone',sectionId:kinds,title:'Milestone',due:'',body:'<p>Something with a date to reach. Set the date underneath.</p>'}),
        block({type:'schedule',sectionId:kinds,title:'Schedule',due:'',body:'<p>Something happening on a day. Also takes a date.</p>'}),
        block({type:'status',sectionId:kinds,title:'Status',status:'In progress',body:''}),
        block({type:'idea',sectionId:kinds,title:'Idea inbox',ideaStage:'Inbox',body:'<p>Somewhere to put a thought before you know what it is. Move it along from Inbox to Exploring, Kept, or Dropped.</p>'}),
        block({type:'note',sectionId:more,title:'Moving things around',body:'<p>Every block has a ⠿ grip at its top right. Hold it and the block lifts and follows the pointer, with a dashed gap showing where it will land.</p><p>Steps inside a practice lesson reorder the same way, and the arrows in a step header do it without a pointer.</p>'}),
        block({type:'note',sectionId:more,title:'Taking it with you',body:'<p><b>Export project</b>, in the project settings behind the cog, writes this whole project to one .json file. <b>Import</b>, beside New in the sidebar, reads one back.</p><p>Importing always makes a new project, so nothing you already have is overwritten. A single lesson exports and imports on its own too, from the buttons on the lesson block.</p>'}),
        block({type:'tasks',sectionId:more,title:'Make it yours',items:[
          {text:'Delete the blocks here you do not need',done:false},
          {text:'Rename this project from the cog',done:false},
          {text:'Or delete the whole thing once you are done',done:false}
        ]})
      ]
    };
  }
  async function addExampleProject(){
    try{
      var made=await restoreProject(exampleProject());
      view='project';activeSection='all';activePage='all';
      await loadProjects(made.projectId);
    }catch(error){
      await notify('The example project could not be added','Check your connection and try again.');
    }
  }
  function exampleSeedKey(){ var user=cloud()&&cloud().user; return 'crowstudies:studio:example:'+(user?user.uid:'anon'); }
  function exampleAlreadyOffered(){ try{ return localStorage.getItem(exampleSeedKey())==='1'; }catch(error){ return true; } }
  function rememberExample(){ try{ localStorage.setItem(exampleSeedKey(),'1'); }catch(error){} }

  async function importProjectFile(){
    var payload=await readJSONFile();
    if(!payload)return;
    if(payload.__broken||payload.crowstudies!=='project'||!payload.project)
      return notify('That file could not be imported','Choose a .json file exported from Studio with Export project.');
    try{
      var done=await restoreProject(payload);
      view='project';activeSection='all';activePage='all';
      await loadProjects(done.projectId);
      await notify('Project imported','“'+done.title+'” is in your workspace with '+done.count+(done.count===1?' block.':' blocks.'));
    }catch(error){
      await notify('The import did not finish','Nothing was changed that could be undone automatically. Check your connection and try again.');
    }
  }
  var floatingCard=null;
  var stopBlocks=null, stopProject=null, stopProjects=null, stopPresence=null, pendingRemote=false, pendingProjectRender=false, pendingBlocksBefore=null, migrated=false;
  var shownBlocks='', shownProject='', shownList='';
  /* Saving a block comes back as a snapshot, and a drag saves every block in
     the grid, so one drop used to echo back as a burst of redraws. What is on
     screen is compared with what arrived, ignoring the timestamps the server
     rewrites, and an echo of our own work is dropped. */
  /* Firestore does not promise to hand a document's fields back in any
     particular order, and the order does change: the copy of a write echoed
     back locally and the copy the server acknowledges can carry the same data
     with its keys arranged differently. JSON.stringify writes keys in the order
     it finds them, so one unchanged project read twice produced two different
     strings, every write looked like news, and the whole workspace was redrawn
     for it. Sorting the keys makes the comparison about content and nothing
     else. */
  function stableJSON(value){
    if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';
    if(value&&typeof value==='object')
      return '{'+Object.keys(value).sort().map(function(key){
        return JSON.stringify(key)+':'+stableJSON(value[key]);
      }).join(',')+'}';
    return JSON.stringify(value===undefined?null:value);
  }
  function withoutStamps(value){
    var copy=Object.assign({}, value);
    delete copy.updatedAt; delete copy.updatedBy; delete copy.createdAt; delete copy.pending;
    return copy;
  }
  function blocksSignature(list){
    return list.map(function(block){ return stableJSON(withoutStamps(block)); }).join('\u0000');
  }
  /* Firestore first reports this browser's pending write, then reports the
     acknowledged copy. Treat an actual content difference stamped by this
     account as an echo, not a reason to rebuild every editor card. A change
     stamped by another account is still allowed through immediately. */
  var inFlight={}, flightMark={};
  /* A write of ours that has left but not landed. The copy Firestore sends back
     in the meantime cannot know about it, so our fields stay on top until the
     write settles rather than being undone by an older truth. */
  function holdInFlight(id, changes){
    inFlight[id]=Object.assign(inFlight[id]||{},changes);
    var mark=(flightMark[id]=(flightMark[id]||0)+1);
    return function(){ if(flightMark[id]===mark){ delete inFlight[id]; delete flightMark[id]; } };
  }
  function adoptBlocks(next){
    var byId={};
    blocks.forEach(function(block){ byId[block.id]=block; });
    var adopted=next.map(function(fresh){
      var held=inFlight[fresh.id];
      if(held)fresh=Object.assign({},fresh,held);
      var mine=byId[fresh.id];
      if(!mine)return fresh;
      Object.keys(mine).forEach(function(key){ if(!(key in fresh))delete mine[key]; });
      Object.assign(mine,fresh);
      return mine;
    });
    /* A block made a moment ago has not been acknowledged yet. Dropping it here
       would take it off the page until the round trip finished. */
    var known={}; adopted.forEach(function(block){ known[block.id]=true; });
    blocks.forEach(function(block){ if(block.pending&&!known[block.id])adopted.push(block); });
    return adopted;
  }
  function liveBlock(id){
    return blocks.filter(function(block){ return block.id===id; })[0];
  }
  function ownBlockEcho(before, after, pending){
    /* The first snapshot is the data that opens a project. It may be stamped
       by this same editor, but it is not an echo and must draw the blocks. */
    if(loadingProject&&before.length===0)return false;
    if(pending)return true;
    var mine=cloud()&&cloud().user&&cloud().user.uid;
    if(!mine)return false;
    var oldById={}; before.forEach(function(block){ oldById[block.id]=block; });
    var nextById={}; after.forEach(function(block){ nextById[block.id]=block; });
    var changed=false;
    for(var id in nextById){
      var previous=oldById[id], current=nextById[id];
      if(!previous||stableJSON(withoutStamps(previous))!==stableJSON(withoutStamps(current))){
        changed=true;
        if(current.updatedBy!==mine)return false;
      }
    }
    for(var oldId in oldById){
      if(!nextById[oldId]){
        changed=true;
        if(oldById[oldId].updatedBy!==mine)return false;
      }
    }
    return changed;
  }
  /* `people` is not project data: it is names and avatars fetched from
     profiles and folded into the copies the list keeps. The single-project
     watcher delivers the raw document without it, so comparing the two as-is
     reported a difference on every write and redrew the whole workspace. What
     actually decides who is in a project is `members`, which is compared. */
  function projectSignature(project){
    if(!project)return '';
    var copy=withoutStamps(project);
    delete copy.people;
    return stableJSON(copy);
  }
  /* Whatever is already drawn counts as seen. Anything that changes a block and
     puts the result on screen itself says so here, so the write coming back
     from the server is not mistaken for news. */
  function markShown(){
    shownBlocks=blocksSignature(blocks);
    shownProject=projectSignature(activeProject);
    shownList=listSignature(window.__crowProjects||[]);
  }
  function listSignature(list){
    return list.map(function(project){ return project.id+':'+project.title; }).join('\u0000');
  }
  /* Someone else's change is held back while a field here has focus, so it can
     never yank the text out from under whoever is typing. */
  function editingNow(){
    var here=document.activeElement;
    if(!here||here===document.body)return false;
    return !!here.closest('.block-grid, .studio-side, .settings-card');
  }
  function canEdit(){ return !activeProject||!cloud().canEdit?true:cloud().canEdit(activeProject); }
  function myRole(){ return cloud().role?cloud().role(activeProject):'owner'; }
  var TABLE_DEFAULT='<table><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody><tr><th>Column</th><th>Column</th></tr><tr><td></td><td></td></tr></tbody></table>';
  function tableColumns(table){ var first=table.rows[0]; return first?first.cells.length:0; }
  function columnWidths(table){
    var group=table.querySelector('colgroup');
    if(!group)return [];
    return Array.prototype.map.call(group.children,function(col){
      var found=/([\d.]+)%/.exec(col.getAttribute('style')||'');
      return found?parseFloat(found[1]):0;
    });
  }
  function setColumnWidths(table, widths){
    var group=table.querySelector('colgroup');
    if(!group)return;
    var total=widths.reduce(function(sum,width){ return sum+(width||0); },0)||1;
    Array.prototype.forEach.call(group.children,function(col,index){
      col.setAttribute('style','width:'+(((widths[index]||0)/total)*100).toFixed(3)+'%');
    });
  }
  /* Holds a table to the shape the editor assumes: the first row is the header,
     every row has the same number of cells, and a colgroup carries the widths.
     Rows and columns added later go through here, so they match the ones the
     table started with. */
  function normalizeTable(table){
    var rows=Array.prototype.slice.call(table.rows);
    if(!rows.length)return;
    var columns=rows.reduce(function(most,row){ return Math.max(most,row.cells.length); },0);
    rows.forEach(function(row,index){
      var want=index===0?'TH':'TD';
      Array.prototype.slice.call(row.cells).forEach(function(cell){
        if(cell.tagName===want)return;
        var swap=document.createElement(want.toLowerCase());
        Array.prototype.forEach.call(cell.attributes,function(attr){ swap.setAttribute(attr.name,attr.value); });
        while(cell.firstChild)swap.appendChild(cell.firstChild);
        row.replaceChild(swap,cell);
      });
      while(row.cells.length<columns)row.appendChild(document.createElement(want.toLowerCase()));
    });
    var group=table.querySelector('colgroup');
    if(!group){ group=document.createElement('colgroup'); table.insertBefore(group,table.firstChild); }
    while(group.children.length>columns)group.removeChild(group.lastChild);
    while(group.children.length<columns)group.appendChild(document.createElement('col'));
    var even=100/Math.max(1,columns);
    setColumnWidths(table,columnWidths(table).map(function(width){ return width>0?width:even; }));
  }
  function cellSpot(cell){ return { row:cell.parentElement.rowIndex, column:cell.cellIndex }; }
  function spanOf(picked){
    if(!picked)return null;
    return {
      top:Math.min(picked.from.row,picked.to.row), bottom:Math.max(picked.from.row,picked.to.row),
      left:Math.min(picked.from.column,picked.to.column), right:Math.max(picked.from.column,picked.to.column)
    };
  }
  async function askName(title, placeholder, action){
    if (window.CrowUI) return window.CrowUI.prompt({title:title,body:'Choose a clear name. You can edit it later.',placeholder:placeholder,confirmLabel:action});
    return prompt(title);
  }
  async function askConfirm(title, body, action){
    if (window.CrowUI) return window.CrowUI.confirm({title:title,body:body,confirmLabel:action,danger:true});
    return confirm(title+'\n\n'+body);
  }
  function sectionName(sectionId){ var found=(activeProject.sections||[]).filter(function(s){return s.id===sectionId;})[0]; return found ? found.title : 'Unsorted'; }
  function findSection(sectionId){ return (activeProject.sections||[]).filter(function(s){return s.id===sectionId;})[0]||null; }
  function sectionPages(sectionId){ var section=findSection(sectionId); return section&&Array.isArray(section.pages)?section.pages:[]; }
  function sectionLocked(sectionId){ var section=findSection(sectionId); return !!(section&&section.locked); }
  function normalizeBlock(block){
    var copy=Object.assign({},block), supported=['note','tasks','status','milestone','schedule','idea','lesson','table','image','quote','callout','code','database'];
    if(copy.type==='task')copy.type='tasks';
    if(supported.indexOf(copy.type)<0)copy.type='note';
    if(!Array.isArray(copy.items))copy.items=[];
    if(typeof copy.title!=='string')copy.title='';
    if(typeof copy.body!=='string')copy.body='';
    ['lessonSection','lessonBlurb','lessonIcon','lessonColor','lessonHint'].forEach(function(key){ if(typeof copy[key]!=='string')copy[key]=''; });
    if(typeof copy.icon!=='string')copy.icon='';
    if(copy.type==='database'){
      if(!Array.isArray(copy.props))copy.props=[];
      if(!Array.isArray(copy.views))copy.views=[];
    }
    if(copy.type==='lesson')copy.steps=lessonSteps(copy);
    return copy;
  }
  /* A remote text edit should replace only its card. Rebuilding the grid makes
     every card run its entry animation again, which looks like the page flashed.
     Structural changes (a new/deleted/reordered visible block) still use render. */
  function visibleBlocks(list){
    var shown=list.filter(function(block){ return (activeSection==='all'||(block.sectionId||'')===activeSection)&&(activePage==='all'||(block.pageId||'')===activePage); });
    return readOnly?shown.filter(function(block){ return !(block.type==='image'&&!block.imageUrl); }):shown;
  }
  function replaceFocusedBody(body, html){
    var selection=window.getSelection(), start=0, end=0;
    try{
      if(selection&&selection.rangeCount){
        var range=selection.getRangeAt(0);
        start=textOffset(body,range.startContainer,range.startOffset);
        end=textOffset(body,range.endContainer,range.endOffset);
      }
    }catch(error){}
    body.innerHTML=cleanHTML(html||'');
    try{
      var a=nodeAtOffset(body,start), b=nodeAtOffset(body,end);
      if(a&&b&&selection){
        var nextRange=document.createRange(); nextRange.setStart(a.node,a.offset); nextRange.setEnd(b.node,b.offset);
        selection.removeAllRanges(); selection.addRange(nextRange);
      }
    }catch(error){}
  }
  function patchFocusedCard(card, before, after){
    var active=document.activeElement;
    var title=card.querySelector('[data-title]'), body=card.querySelector('[data-body]');
    var changedTitle=before.title!==after.title, changedBody=before.body!==after.body;
    /* Apply an incoming edit even in the exact field being viewed. The caret
       is restored to the nearest matching text offset, so live changes do not
       wait for a click outside the block. */
    if(changedTitle&&title){
      var titleStart=active===title?title.selectionStart:0, titleEnd=active===title?title.selectionEnd:0;
      title.value=after.title||'';
      if(active===title)try{ title.setSelectionRange(Math.min(titleStart,title.value.length),Math.min(titleEnd,title.value.length)); }catch(error){}
    }
    if(changedBody&&body){
      if(active===body)replaceFocusedBody(body,after.body||'');
      else body.innerHTML=cleanHTML(after.body||'');
    }
    var oldRest=Object.assign({},withoutStamps(before)), nextRest=Object.assign({},withoutStamps(after));
    delete oldRest.title; delete oldRest.body; delete nextRest.title; delete nextRest.body;
    return JSON.stringify(oldRest)===JSON.stringify(nextRest);
  }
  function patchLiveBlocks(before, after){
    if(!root||view!=='project'||loadingProject)return false;
    var oldShown=visibleBlocks(before), nextShown=visibleBlocks(after);
    if(oldShown.length!==nextShown.length)return false;
    for(var i=0;i<oldShown.length;i++)if(oldShown[i].id!==nextShown[i].id)return false;
    var changed=false, blocked=false;
    nextShown.forEach(function(block,index){
      if(stableJSON(withoutStamps(oldShown[index]))===stableJSON(withoutStamps(block)))return;
      var card=root.querySelector('[data-block="'+block.id+'"]');
      if(!card){ blocked=true; return; }
      if(card.contains(document.activeElement)){
        if(!patchFocusedCard(card,oldShown[index],block)){ blocked=true; return; }
        changed=true; return;
      }
      var replacement=swapNode(card,blockHTML(block));
      if(!replacement){ blocked=true; return; }
      replacement.classList.add('no-entry','remote-patch');
      changed=true;
    });
    if(blocked)return false;
    if(changed){ bind(); paintPresence(); }
    return true;
  }
  var livePeople=[], presenceTimer=null, presenceFrame=0, lastPresenceKey='', lastPresenceSent=0, presenceWarningShown=false;
  function initialsFrom(name){ return String(name||'?').trim().split(/\s+/).slice(0,2).map(function(part){return part.charAt(0);}).join('').toUpperCase()||'?'; }
  function textOffset(host,node,offset){
    try{ var range=document.createRange(); range.selectNodeContents(host); range.setEnd(node,offset); return range.toString().length; }catch(error){ return 0; }
  }
  function presenceState(){
    if(!activeProject||!cloud().user)return null;
    var active=document.activeElement, card=active&&active.closest&&active.closest('[data-block]');
    if(!card)return {blockId:'',field:'',start:0,end:0};
    var body=card.querySelector('[data-body]'), field=active.getAttribute&&active.getAttribute('data-title')!==null?'title':'';
    var start=0,end=0;
    if(field==='title'){ start=active.selectionStart||0; end=active.selectionEnd||start; }
    else if(body&&body.contains(active)){
      var selection=window.getSelection();
      field='body';
      if(selection&&selection.rangeCount){ var range=selection.getRangeAt(0); start=textOffset(body,range.startContainer,range.startOffset); end=textOffset(body,range.endContainer,range.endOffset); }
    } else field='field';
    return {blockId:card.dataset.block,field:field,start:start,end:end};
  }
  function presenceFailed(error){
    if(presenceWarningShown)return;
    presenceWarningShown=true;
    console.warn('CrowStudies live presence is unavailable',error);
    if(window.CrowUI)window.CrowUI.notice({title:'Live collaboration is unavailable',body:'Your project still saves normally, but viewer status and cursors could not connect. Check the Firestore presence rules and reload.'});
  }
  function sendPresence(force){
    if(previewing())return;
    var state=presenceState(); if(!state)return;
    var key=JSON.stringify(state), now=Date.now();
    if(!force&&key===lastPresenceKey)return;
    if(!force&&now-lastPresenceSent<120){
      clearTimeout(presenceTimer);
      presenceTimer=setTimeout(function(){ sendPresence(false); },120-(now-lastPresenceSent));
      return;
    }
    lastPresenceKey=key; lastPresenceSent=now;
    cloud().savePresence(activeProject.id,state).catch(presenceFailed);
  }
  function queuePresence(){
    if(presenceFrame)return;
    presenceFrame=requestAnimationFrame(function(){ presenceFrame=0; sendPresence(false); });
  }
  /* A short heartbeat makes a closed tab or lost focus disappear quickly
     instead of leaving a ghost marker for half a minute. */
  setInterval(function(){ if(activeProject&&cloud().user)sendPresence(true); },2000);
  document.addEventListener('visibilitychange',function(){ if(!document.hidden&&activeProject&&cloud().user){lastPresenceKey='';sendPresence(true);} });
  function nodeAtOffset(host, offset){
    var walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT), node, left=Math.max(0,offset);
    while((node=walker.nextNode())){ if(left<=node.nodeValue.length)return {node:node,offset:left}; left-=node.nodeValue.length; }
    return null;
  }
  function paintPresence(){
    if(!root)return;
    root.querySelectorAll('.collab-marker,.collab-selection-rect').forEach(function(node){node.remove();});
    var people=root.querySelector('[data-collab-people]');
    if(people){people.innerHTML=livePeople.map(function(person){ var face=person.avatarUrl?'<span class="collab-face" style="background-image:url(&quot;'+esc(person.avatarUrl)+'&quot;)"></span>':'<b>'+esc(initialsFrom(person.name))+'</b>'; return '<span class="collab-person '+(person.avatarUrl?'has-face':'')+'" title="@'+esc(person.name||'someone')+' is viewing">'+face+'<i></i></span>';}).join('');var presence=people.closest('.project-presence');if(presence)presence.hidden=!livePeople.length;}
    livePeople.forEach(function(person){
      if(!person.blockId)return;
      var card=root.querySelector('[data-block="'+person.blockId+'"]');
      if(!card)return;
      var marker=document.createElement('span'); marker.className='collab-marker'; marker.textContent=(person.name||'Someone')+(person.field==='title'?' is editing the title':' is here');
      card.appendChild(marker);
      if(person.field!=='body')return;
      var body=card.querySelector('[data-body]'); if(!body)return;
      var a=nodeAtOffset(body,person.start||0), b=nodeAtOffset(body,person.end||person.start||0); if(!a||!b)return;
      try{
        var range=document.createRange(); range.setStart(a.node,a.offset); range.setEnd(b.node,b.offset);
        var cardBox=card.getBoundingClientRect();
        Array.prototype.forEach.call(range.getClientRects(),function(rect){
          var shade=document.createElement('span'); shade.className='collab-selection-rect';
          shade.style.left=(rect.left-cardBox.left)+'px'; shade.style.top=(rect.top-cardBox.top)+'px';
          shade.style.width=Math.max(3,rect.width)+'px'; shade.style.height=Math.max(16,rect.height)+'px'; card.appendChild(shade);
        });
      }catch(error){}
    });
  }
  document.addEventListener('selectionchange',queuePresence);
  document.addEventListener('focusin',queuePresence,true);
  document.addEventListener('focusout',queuePresence,true);
  document.addEventListener('pointerout',function(event){
    var card=event.target.closest&&event.target.closest('[data-block]');
    if(!card||card.contains(event.relatedTarget))return;
    if(!activeProject||!cloud().user)return;
    lastPresenceKey=''; cloud().savePresence(activeProject.id,{blockId:'',field:'',start:0,end:0}).catch(function(){});
  },true);
  window.addEventListener('pagehide',function(){
    if(activeProject&&cloud().user)cloud().savePresence(activeProject.id,{blockId:'',field:'',start:0,end:0}).catch(function(){});
  });
  function ownsProject(project){
    var user=cloud()&&cloud().user;
    return !!(user&&project&&(project.owner===user.uid||((project.members||{})[user.uid]==='owner')));
  }
  function projectCompanions(project){
    var user=cloud()&&cloud().user, members=Object.keys(project.members||{});
    return members.filter(function(uid){ return !user||uid!==user.uid; }).length;
  }
  function projectRowHTML(project){
    var current=activeProject&&project.id===activeProject.id, shared=!ownsProject(project);
    var role=cloud().role?cloud().role(project):'owner', other=projectCompanions(project);
    var owner=(project.people&&project.people[project.owner]&&project.people[project.owner].name)||'Another person';
    var detail=shared?'Shared by '+owner+' · '+(role==='viewer'?'view only':'can edit'):(other?other+(other===1?' collaborator':' collaborators'):'Private');
    return '<div class="project-row '+(shared?'is-shared':'is-personal')+'"><button class="project-item '+(current?'active ':'')+(shared?'shared':'')+'" data-project="'+project.id+'" title="'+esc(project.title)+'"><span class="project-row-title">'+esc(project.title)+'</span><small>'+esc(detail)+'</small></button>'+'<button class="project-cog" data-project-settings="'+project.id+'" title="Settings for '+esc(project.title)+'" aria-label="Settings for '+esc(project.title)+'">&#9881;</button></div>';
  }
  function projectListHTML(projects){
    var personal=projects.filter(ownsProject), shared=projects.filter(function(project){ return !ownsProject(project); });
    function group(title, kind, list){
      if(!list.length)return '';
      return '<section class="project-group '+kind+'"><h3>'+title+' <span>'+list.length+'</span></h3>'+list.map(projectRowHTML).join('')+'</section>';
    }
    return group('Your projects','personal',personal)+group('Shared with you','shared',shared)
      || '<p class="project-list-empty">No projects yet.</p>';
  }
  /* Settings is another page of the same project rather than a different
     place, so it arrives as one: the browser holds the panel that is leaving
     over the one arriving and fades between them. Anyone who has asked for
     less motion, and any browser without view transitions, gets the redraw on
     its own — the same page, just immediately. */
  function renderSwitch(){
    var still=false;
    try{ still=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(error){}
    if(still||typeof document.startViewTransition!=='function'){ render(); return; }
    var page=document.documentElement;
    page.classList.add('studio-switch');
    var done=function(){ page.classList.remove('studio-switch'); };
    try{
      var move=document.startViewTransition(function(){ render(); });
      /* A transition the browser decides not to run — a tab in the background,
         another one already going — still redraws the page, and only reports
         the skip. There is nothing to recover from, so it is not an error. */
      if(move&&move.finished&&move.finished.catch)move.finished.catch(function(){}).then(done,done);
      else done();
    }catch(error){ done(); render(); }
  }
  function render(){
    /* A structural redraw closes open document providers. Normal remote note
       edits are transported by Yjs and never redraw Studio or rewrite HTML. */
    if(window.CrowCollab&&window.CrowCollab.destroyAll)window.CrowCollab.destroyAll();
    shownBlocks=blocksSignature(blocks);
    shownProject=projectSignature(activeProject);
    shownList=listSignature(window.__crowProjects||[]);
    /* A card lifted out of the grid lives on the body. Rebuilding the grid
       would strand it there, so let it go first: render draws it back. */
    if(floatingCard){ if(floatingCard.parentNode)floatingCard.parentNode.removeChild(floatingCard); floatingCard=null; }
    if (!cloud() || cloud().initializing){
      root.innerHTML='<main class="studio-main studio-gate"><div class="studio-empty studio-loading"><span class="studio-spinner"></span><h1>Opening Studio</h1><p>Restoring your workspace…</p></div></main>'; return;
    }
    if (!cloud().user){
      root.innerHTML='<main class="studio-main studio-gate"><div class="studio-empty"><h1>Your private workspace</h1><p>Sign in to create projects that follow you between devices.</p><button class="btn" data-firebase-auth>Sign in to begin</button></div></main>'; return;
    }
    if (studioError){
      root.innerHTML='<main class="studio-main studio-gate"><div class="studio-empty"><h1>Studio could not open</h1><p>'+esc(studioError)+'</p><button class="btn" data-retry-studio>Try again</button></div></main>';
      root.querySelector('[data-retry-studio]').onclick=function(){ studioError=''; loadProjects(); }; return;
    }
    var projects=window.__crowProjects||[];
    root.classList.toggle('side-closed',!sideOpen);
    root.innerHTML='<div class="side-scrim" data-side-close'+(sideOpen?'':' hidden')+'></div><aside class="studio-side'+(sideOpen?' is-open':'')+'">'+sideToggleHTML('in-rail')+'<div class="studio-sidehead"><h2>Projects</h2><div class="side-actions"><button class="btn ghost sm" data-import-project title="Import a project from a .json file">Import</button><button class="btn sm" data-new-project>New</button></div></div><div class="project-list">'+projectListHTML(projects)+'</div></aside><main class="studio-main '+((readOnly||!canEdit())?'read-only':'')+(previewing()?' in-preview':'')+'">'+sideToggleHTML('on-top')+(activeProject ? (view==='settings'?settingsHTML():projectHTML()) : '<div class="studio-empty"><h1>Make a project</h1><p>Collect study notes, plans, schedules, ideas, and your own practice cards in one place.</p><button class="btn" data-new-project>New project</button><button class="btn ghost" data-example-project>Add the example project</button><button class="btn ghost" data-import-project>Import a project</button></div>')+'</main>';
    bind();
    mountCollaborativeEditors();
    mountDatabases();
    blocks.filter(isDatabase).forEach(function(block){
      var card=root.querySelector('[data-block="'+block.id+'"]');
      if(card)paintDatabase(card,block);
    });
    /* Tasks, History and the comment rows are added by the upgrades script,
       which used to hear about a redraw from a MutationObserver and act on the
       next tick — after the browser had already painted the page without them,
       so the header shuffled a frame later. Asking for them here puts them in
       before anything is shown. */
    try{ if(window.CrowStudioUpgrades&&window.CrowStudioUpgrades.decorate)window.CrowStudioUpgrades.decorate(); }catch(error){}
    setTimeout(paintPresence,0);
  }
  function mountCollaborativeEditors(){
    /* A shared note is a live document. Mounting one here would quietly put
       today's text inside a page that is meant to be showing an old one. */
    if(previewing())return;
    if(!window.CrowCollab||!window.CrowCollab.enabled()||!activeProject||!cloud().user)return;
    root.querySelectorAll('[data-block].note [data-body]').forEach(function(body){
      var card=body.closest('[data-block]'), block=blocks.filter(function(item){return item.id===card.dataset.block;})[0];
      if(!block||body.dataset.collabActive==='true')return;
      /* The plain toolbar stays until the shared one exists, so the row is
         never missing from the card in between. */
      var oldTools=card.querySelector('.rich-tools');
      window.CrowCollab.mount(body,{
        documentName:'project:'+activeProject.id+':block:'+block.id,
        user:cloud().user,
        username:(cloud().profile&&cloud().profile.username)||'someone',
        avatarUrl:(cloud().profile&&cloud().profile.avatarUrl)||'',
        readOnly:readOnly||!canEdit()||sectionLocked(block.sectionId),
        onStatus:function(status){ card.classList.toggle('collab-offline',status!=='connected'); }
      }).then(function(entry){
        if(entry&&oldTools)oldTools.hidden=true;
      }).catch(function(error){
        body.dataset.collabActive='';
        if(oldTools)oldTools.hidden=false;
        body.innerHTML=cleanHTML(block.body);
        card.classList.add('collab-offline');
        console.warn('Collaborative note unavailable',error);
      });
    });
  }
  function sectionMenuHTML(section){
    return '<div class="section-popover"><button data-add-page="'+section.id+'">Add page</button>'
      +'<button data-lock-section="'+section.id+'">'+(section.locked?'Unlock section':'Lock section')+'</button>'
      +'<button class="danger" data-remove-section="'+section.id+'">Delete section</button></div>';
  }
  function closeSectionMenu(){
    openSectionMenu='';
    var open=root.querySelector('.section-popover');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
  }
  /* Opening the cog used to re-render the whole workspace, which rebuilt the
     sidebar and every block just to show three buttons. The menu is added and
     taken away on its own now. */
  function toggleSectionMenu(sectionId){
    var wasOpen=openSectionMenu===sectionId;
    closeSectionMenu();
    if(wasOpen)return;
    var cog=root.querySelector('[data-section-menu="'+sectionId+'"]');
    var section=findSection(sectionId);
    if(!cog||!cog.parentNode||!section)return;
    openSectionMenu=sectionId;
    cog.parentNode.insertAdjacentHTML('beforeend',sectionMenuHTML(section));
    bindSectionMenu(cog.parentNode);
  }
  var watchingSectionMenu=false;
  function watchSectionMenu(){
    if(watchingSectionMenu)return;
    watchingSectionMenu=true;
    document.addEventListener('pointerdown',function(event){
      if(!openSectionMenu)return;
      if(event.target.closest('.section-popover')||event.target.closest('[data-section-menu]'))return;
      closeSectionMenu();
    },true);
  }
  function whenSaved(ms){
    var then=new Date(ms||0), now=new Date();
    var sameDay=then.toDateString()===now.toDateString();
    var time=then.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    return sameDay?'today at '+time:then.toLocaleDateString([], { month:'long', day:'numeric' })+' at '+time;
  }
  /* The one thing on the page that says you are not where you left off. It
     stays put at the top while you read, and both ways out are on it. */
  function previewBarHTML(){
    if(!previewing())return '';
    var who=preview.author?' · saved by '+esc(preview.author):'';
    return '<div class="preview-bar" role="status"><span class="preview-dot" aria-hidden="true"></span>'
      +'<div class="preview-said"><b>'+esc(preview.label||'Earlier version')+'</b>'
      +'<span>Viewing a version from '+esc(whenSaved(preview.createdMs))+who+'. Nothing here can be edited, and live changes from other people are paused.</span></div>'
      +'<button class="btn ghost sm" data-exit-preview>Back to the current version</button></div>';
  }
  function enterPreview(entry){
    if(!activeProject||!entry||!entry.snapshot)return false;
    if(!preview)liveState={ project:activeProject, blocks:blocks, readOnly:readOnly, section:activeSection, page:activePage, view:view };
    dropWatchers();
    var data=entry.snapshot;
    preview={ id:entry.id, label:entry.label, kind:entry.kind, createdMs:entry.createdMs, author:entry.author, snapshot:data };
    /* The version stores what the project said, not who could see it, so the
       live project's membership is kept underneath. */
    activeProject=Object.assign({},liveState.project,{
      title:(data.project&&data.project.title)||liveState.project.title,
      sections:(data.project&&data.project.sections)||[]
    });
    blocks=(Array.isArray(data.blocks)?data.blocks:[]).map(normalizeBlock)
      .sort(function(a,b){ return (a.order||0)-(b.order||0); });
    readOnly=true; view='project'; activeSection='all'; activePage='all'; loadingProject=false;
    render();
    return true;
  }
  function exitPreview(){
    if(!preview)return;
    var back=liveState;
    preview=null; liveState=null;
    activeProject=back.project; blocks=back.blocks; readOnly=back.readOnly;
    activeSection=back.section; activePage=back.page; view=back.view;
    render();
    /* Back on the live copy, so pick the conversation up again. */
    watchActiveProject();
    loadProjects(activeProject&&activeProject.id);
  }
  /* Restoring writes the version over the project in place, so the address and
     everyone it is shared with stay as they are. Blocks the version never had
     are removed; the ones it does have are written back under their own ids, so
     a restore is a move backwards rather than a second copy. */
  async function restoreSnapshot(data){
    if(!activeProject||!data)return;
    var projectId=activeProject.id;
    var incoming=(Array.isArray(data.blocks)?data.blocks:[]).map(normalizeBlock);
    var keep={};
    incoming.forEach(function(block){ keep[block.id]=true; });
    var current=await cloud().listBlocks(projectId);
    for(var i=0;i<current.length;i++){
      if(keep[current[i].id])continue;
      await cloud().deleteBlock(projectId,current[i].id);
    }
    for(var j=0;j<incoming.length;j++){
      var copy=Object.assign({},incoming[j]);
      delete copy.pending;
      await cloud().saveBlock(projectId,copy.id,copy);
      if(copy.type!=='database')continue;
      /* Rows go back under their own ids, so one that was there before and
         after is the same row rather than a second copy of itself. */
      var want=(data.rows||{})[copy.id]||[];
      var keepRows={}; want.forEach(function(row){ keepRows[row.id]=true; });
      var here=await cloud().listRows(projectId,copy.id);
      for(var k=0;k<here.length;k++){
        if(!keepRows[here[k].id])await cloud().removeRow(projectId,copy.id,here[k].id);
      }
      for(var m=0;m<want.length;m++){
        await cloud().saveRow(projectId,copy.id,want[m].id,{ order:want[m].order||m, values:want[m].values||{} });
      }
    }
    await cloud().saveProject(projectId,{
      title:(data.project&&data.project.title)||activeProject.title,
      sections:(data.project&&data.project.sections)||[]
    });
    return projectId;
  }
  function freeImageSlot(block){
    if(block.imageSlot)return block.imageSlot;
    var used={};
    blocks.filter(function(item){ return item.type==='image'&&item.imageSlot; })
      .forEach(function(item){ used[item.imageSlot]=true; });
    for(var number=1;number<=20;number++){
      var candidate='image-'+String(number).padStart(2,'0');
      if(!used[candidate])return candidate;
    }
    return '';
  }
  async function takeImage(block, file, control){
    var slot=freeImageSlot(block);
    if(!slot){ await notify('Project image limit reached','A project can store up to 20 images (30 MB total). Delete an uploaded image to free a slot.'); return; }
    try{
      if(control)control.disabled=true;
      var media=await cloud().uploadProjectImage(activeProject.id,slot,file);
      block.imageSlot=media.slot; block.imageUrl=media.url;
      await cloud().patchBlock(activeProject.id,block.id,{imageSlot:block.imageSlot,imageUrl:block.imageUrl});
      render();
    }catch(error){
      await notify('Image not uploaded',error.message||'Try a JPEG, PNG, or WebP under 1.5 MB.');
      if(control)control.disabled=false;
    }
  }
  /* The panel is already the thing you click, so it may as well be the thing
     you drop onto. */
  function bindImageDrop(zone, block){
    ['dragenter','dragover'].forEach(function(name){
      zone.addEventListener(name,function(event){ event.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave','dragend'].forEach(function(name){
      zone.addEventListener(name,function(){ zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop',function(event){
      event.preventDefault(); zone.classList.remove('is-over');
      var file=event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0];
      if(file)takeImage(block,file,null);
    });
  }
  function projectHTML(){
    var sections=activeProject.sections||[];
    var shown=blocks.filter(function(b){return (activeSection==='all'||(b.sectionId||'')===activeSection)&&(activePage==='all'||(b.pageId||'')===activePage);});
    /* An empty image block is only a prompt to paste a URL, which is no use
       to someone reading the project. */
    if(readOnly)shown=shown.filter(function(b){ return !(b.type==='image'&&!b.imageUrl); });
    var sectionButtons=sections.map(function(s){var selected=activeSection===s.id, menu=openSectionMenu===s.id;return '<div class="section-choice"><button class="section-filter '+(selected?'active':'')+'" data-section="'+s.id+'" title="'+esc(s.title)+'">'+esc(s.title)+(s.locked?' · locked':'')+'</button><button class="section-cog" data-section-menu="'+s.id+'" aria-label="Section settings">⚙</button>'+(menu?sectionMenuHTML(s):'')+'</div>';}).join('');
    var pages=activeSection&&activeSection!=='all'?sectionPages(activeSection):[];
    var pageBar=activeSection&&activeSection!=='all'?'<div class="page-bar"><button class="page-filter '+(activePage==='all'?'active':'')+'" data-page="all">All pages</button>'+pages.map(function(p){return '<button class="page-filter '+(activePage===p.id?'active':'')+'" data-page="'+p.id+'">'+esc(p.title)+'</button>';}).join('')+'</div>':'';
    var locked=activeSection&&activeSection!=='all'&&sectionLocked(activeSection);
    if(loadingProject){
      return previewBarHTML()+'<div class="project-top"><h1 class="project-title">'+esc(activeProject.title)+'</h1></div>'
        +'<div class="block-grid is-loading">'+[0,1,2,3].map(function(){ return '<article class="studio-block block-skeleton"><span></span><span></span><span></span></article>'; }).join('')+'</div>';
    }
    var companions=projectCompanions(activeProject), shared=!ownsProject(activeProject);
    var access=shared?'Shared · '+(myRole()==='viewer'?'view only':'can edit'):(companions?companions+(companions===1?' collaborator':' collaborators')+' · shared':'Private project');
    var overview=blocks.length+' '+(blocks.length===1?'block':'blocks')+' · '+sections.length+' '+(sections.length===1?'section':'sections');
    var actions=previewing()
      ? '<button class="btn sm" data-restore-preview>Restore this version</button>'
      : '<button class="btn ghost sm" data-toggle-view>'+ (readOnly?'Edit project':'View project') +'</button><button class="btn ghost sm" data-new-section>+ Section</button>';
    return previewBarHTML()+'<div class="project-top"><div class="project-heading"><h1 class="project-title">'+esc(activeProject.title)+'</h1><div class="project-meta"><span class="'+(shared?'shared':'private')+'">'+esc(access)+'</span><span>'+esc(overview)+'</span></div><div class="project-presence" hidden><span>Viewing now</span><div class="collab-people" data-collab-people aria-label="People viewing this project"></div></div></div><div class="project-actions">'+actions+'</div></div><div class="section-bar"><button class="section-filter '+(activeSection==='all'?'active':'')+'" data-section="all">All</button><button class="section-filter '+(activeSection===''?'active':'')+'" data-section="">Unsorted</button>'+sectionButtons+'</div>'+pageBar+(locked?'<p class="section-lock-note">This section is locked. Unlock it from its cog menu to edit.</p>':'')+'<div class="block-grid">'+shown.map(blockHTML).join('')+'</div><div class="add-row '+(locked?'is-locked':'')+'">'+(locked?'<span>This section is locked</span>':'<button type="button" class="add-open" data-add-open>+ Add block</button>')+'</div>';
  }
  function personName(uid){
    var people=(activeProject&&activeProject.people)||{};
    var who=people[uid];
    if(who&&who.name)return who.name;
    if(cloud().user&&cloud().user.uid===uid)return 'You';
    return 'Someone';
  }
  function shareCardHTML(){
    var owner=myRole()==='owner';
    var members=Object.keys((activeProject&&activeProject.members)||{});
    var invites=Object.keys((activeProject&&activeProject.invites)||{});
    var rows=members.map(function(uid){
      var role=activeProject.members[uid];
      var self=cloud().user&&cloud().user.uid===uid;
      return '<div class="share-row"><span class="share-who"><b>'+esc(personName(uid))+(self?' (you)':'')+'</b>'
        +'<small>'+esc((activeProject.people&&activeProject.people[uid]&&activeProject.people[uid].email)||'')+'</small></span>'
        +'<span class="share-role">'+esc(role)+'</span>'
        +((owner&&!self)?'<button class="btn ghost sm danger-action" data-remove-member="'+uid+'">Remove</button>':'')
        +'</div>';
    }).join('');
    var waiting=invites.map(function(key){
      var address=key.replace(/%2E/g,'.');
      return '<div class="share-row pending"><span class="share-who"><b>'+esc(address)+'</b><small>invited, not joined yet</small></span>'
        +'<span class="share-role">'+esc(activeProject.invites[key])+'</span>'
        +(owner?'<button class="btn ghost sm danger-action" data-withdraw-invite="'+esc(address)+'">Withdraw</button>':'')
        +'</div>';
    }).join('');
    return '<section class="settings-card"><h2>People</h2>'
      +'<p>Everyone here works on the same project at the same time. Changes show up as they happen.</p>'
      +'<div class="share-list">'+rows+waiting+'</div>'
      +(owner?'<div class="settings-inline share-invite"><input class="dialog-input" data-invite-username placeholder="username" autocomplete="off">'
        +'<select class="status-select" data-invite-role><option value="editor">Can edit</option><option value="viewer">Can view</option></select>'
        +'<button class="btn sm" data-send-invite>Invite</button></div>'
        +'<p class="share-note">They sign in with that address and the project appears in their Studio.</p>':'')
      +'</section>';
  }
  function settingsHTML(){
    var sections=activeProject.sections||[];
    return '<div class="settings-top"><button class="btn ghost sm" data-settings-back>← Back to project</button><h1>Project settings</h1><p>Change the project details and organize its sections.</p></div><section class="settings-card"><h2>Project name</h2><div class="settings-inline"><input class="dialog-input" data-project-name value="'+esc(activeProject.title)+'"><button class="btn sm" data-save-project-name>Save</button></div></section><section class="settings-card"><h2>Sections</h2><p>Deleting a section keeps its blocks and moves them to Unsorted.</p><div class="section-settings">'+(sections.length?sections.map(function(s){return '<div><span>'+esc(s.title)+'</span><button class="btn ghost sm danger-action" data-delete-section="'+s.id+'">Delete</button></div>';}).join(''):'<p>No custom sections yet.</p>')+'</div></section>'+shareCardHTML()+'<section class="settings-card"><h2>Import and export</h2><p>Export writes this project, its sections, and every block to one .json file. Importing always creates a new project, so nothing here is overwritten.</p><div class="settings-inline"><button class="btn sm" data-export-project>Export project</button><button class="btn ghost sm" data-import-project>Import a project</button></div></section>'+(myRole()==='owner'
      ?'<section class="settings-card settings-danger"><h2>Danger zone</h2><p>Delete this project and every block inside it, for everyone it is shared with.</p><button class="btn bad sm" data-delete-project>Delete project</button></section>'
      :'<section class="settings-card"><h2>Leave this project</h2><p>It stays as it is for everyone else.</p><button class="btn ghost sm danger-action" data-leave-project>Leave project</button></section>')+'';
  }
  /* Studio lessons use the same shape the published courses use: a unit with a
     summary, icon, color and hint, holding steps that teach a titled section
     first and then ask about it. */
  var LESSON_KINDS=[{value:'explain',label:'Teach only'},{value:'choice',label:'Multiple choice'},{value:'free',label:'Free response'}];
  var LESSON_DEFAULT_COLOR='#7657f7';
  function normalizeStep(step){
    var copy=Object.assign({kind:'explain',title:'',body:'',practice:'',prompt:'',answer:'',options:[]},step||{});
    if(!LESSON_KINDS.some(function(kind){return kind.value===copy.kind;}))copy.kind='explain';
    if(!Array.isArray(copy.options))copy.options=[];
    copy.options=copy.options.map(function(option){return String(option);});
    ['title','body','practice','prompt','answer'].forEach(function(key){ if(typeof copy[key]!=='string')copy[key]=''; });
    delete copy.questions;
    /* Earlier Studio lessons kept the teaching text in `prompt`. */
    if(copy.kind==='explain'&&copy.prompt&&!copy.body){ copy.body=copy.prompt; copy.prompt=''; }
    /* Every choice, right or wrong, is one row. Older lessons kept the correct
       answer out of the list, so fold it back in. */
    if(copy.kind==='choice'){
      if(copy.answer&&copy.options.indexOf(copy.answer)<0)copy.options=copy.options.concat([copy.answer]);
      while(copy.options.length<2)copy.options=copy.options.concat(['']);
    }
    return copy;
  }
  function lessonSteps(block){
    var steps=Array.isArray(block.steps)&&block.steps.length
      ? block.steps
      : [{kind:'explain',title:'What to know',body:block.body||''},{kind:'free',prompt:block.practice||'',answer:block.answer||''}];
    return steps.map(normalizeStep);
  }
  function lessonMeta(block){
    return {
      section:block.lessonSection||sectionName(block.sectionId||''),
      blurb:block.lessonBlurb||'',
      icon:block.lessonIcon||'✦',
      color:/^#[0-9a-f]{6}$/i.test(block.lessonColor||'')?block.lessonColor:LESSON_DEFAULT_COLOR,
      hint:block.lessonHint||''
    };
  }
  /* Only the step being worked on is drawn. The rest stay as one-line rows, so
     a twenty-step lesson is the same height as a two-step one. Which step is
     open, and whether the details panel is unfolded, are remembered per block
     so a re-render does not throw the person back to the top. */
  var openStep={}, openDetails={};
  function stepKindLabel(kind){
    var found=LESSON_KINDS.filter(function(entry){ return entry.value===kind; })[0];
    return found?found.label:'Teach only';
  }
  function currentStep(block, total){
    var chosen=openStep[block.id];
    if(typeof chosen!=='number'||chosen<0||chosen>=total)chosen=0;
    return chosen;
  }
  function lessonDetailsHTML(block, meta, disabled){
    var unfolded=!!openDetails[block.id];
    var peek=[meta.section,meta.blurb].filter(Boolean).join(' · ')||'Add a section and summary';
    var head='<div class="lesson-details" data-lesson-details-region>'
      +'<button class="lesson-details-toggle" data-lesson-details aria-expanded="'+(unfolded?'true':'false')+'">'
      +'<span class="chev" aria-hidden="true">'+(unfolded?'▾':'▸')+'</span>'
      +'<b>Lesson details</b>'
      +'<span class="lesson-details-peek">'+esc(peek)+'</span>'
      +'<span class="lesson-dot" style="background:'+esc(meta.color)+'" aria-hidden="true">'+esc(meta.icon)+'</span>'
      +'</button>';
    if(!unfolded)return head+'</div>';
    return head+'<div class="lesson-meta">'
      +'<label class="lesson-field"><span>Section</span><input data-lesson-section value="'+esc(meta.section)+'" placeholder="e.g. Tones"'+disabled+'></label>'
      +'<label class="lesson-field"><span>Summary</span><input data-lesson-blurb value="'+esc(meta.blurb)+'" placeholder="e.g. the pairs everyone mixes up"'+disabled+'></label>'
      +'<label class="lesson-field tiny"><span>Icon</span><input data-lesson-icon value="'+esc(meta.icon)+'" maxlength="4"'+disabled+'></label>'
      +'<label class="lesson-field tiny"><span>Color</span><input type="color" data-lesson-color value="'+esc(meta.color)+'"'+disabled+'></label>'
      +'<label class="lesson-field wide"><span>Hint</span><textarea data-lesson-hint placeholder="What the hint button should reveal during practice."'+disabled+'>'+esc(meta.hint)+'</textarea></label>'
      +'</div></div>';
  }
  function stepEditorHTML(block, step, index, total, disabled){
    var asks=step.kind!=='explain';
    var first=index===0, last=index===total-1;
    var choices=step.kind==='choice'
      ? '<div class="choice-list" data-choices="'+index+'"><span class="choice-hint">Mark the correct answer</span>'
        +step.options.map(function(option,slot){
          var correct=option!==''&&option===step.answer;
          return '<div class="choice-row">'
            +'<input type="radio" name="choice-'+block.id+'-'+index+'" data-choice-correct="'+index+'" value="'+slot+'" '+(correct?'checked':'')+disabled+' aria-label="Mark choice '+(slot+1)+' as correct">'
            +'<input data-choice-text="'+index+'" data-choice-slot="'+slot+'" value="'+esc(option)+'" placeholder="Choice '+(slot+1)+'"'+disabled+'>'
            +'<button data-remove-choice="'+index+'" data-choice-slot="'+slot+'"'+disabled+' aria-label="Remove choice '+(slot+1)+'">×</button>'
            +'</div>';
        }).join('')
        +'<button class="add-task" data-add-choice="'+index+'"'+disabled+'>+ Add choice</button></div>'
      : '';
    return '<section class="lesson-step" id="lesson-step-'+block.id+'-'+index+'" role="tabpanel">'
      +'<div class="lesson-step-head"><span>Step '+(index+1)+'</span><select data-step-kind="'+index+'"'+disabled+'>'
      +LESSON_KINDS.map(function(kind){return '<option value="'+kind.value+'" '+(step.kind===kind.value?'selected':'')+'>'+kind.label+'</option>';}).join('')
      +'</select>'
      +'<button class="step-move" data-move-step="'+index+'" data-move-to="'+(index-1)+'"'+(first?' disabled':disabled)+' aria-label="Move this step earlier" title="Move earlier">↑</button>'
      +'<button class="step-move" data-move-step="'+index+'" data-move-to="'+(index+1)+'"'+(last?' disabled':disabled)+' aria-label="Move this step later" title="Move later">↓</button>'
      +'<button data-remove-step="'+index+'"'+disabled+' aria-label="Remove lesson step">×</button></div>'
      +'<input data-step-title="'+index+'" value="'+esc(step.title)+'" placeholder="Section title, e.g. A whole step skips one key"'+disabled+'>'
      +'<textarea data-step-body="'+index+'" placeholder="Teach the idea in a few clear lines."'+disabled+'>'+esc(step.body)+'</textarea>'
      +(asks
        ? '<input data-step-practice="'+index+'" value="'+esc(step.practice)+'" placeholder="What the next practice will ask"'+disabled+'>'
          +'<textarea data-step-prompt="'+index+'" placeholder="The question learners will see"'+disabled+'>'+esc(step.prompt)+'</textarea>'
          +(step.kind==='choice'?choices:'<input data-step-answer="'+index+'" value="'+esc(step.answer)+'" placeholder="Correct answer"'+disabled+'>')
        : '')
      +'</section>';
  }
  function lessonBuilderHTML(block, disabled){
    var steps=lessonSteps(block), chosen=currentStep(block,steps.length);
    var rail='<div class="step-rail" role="tablist" aria-label="Lesson steps">'
      +steps.map(function(step,index){
        var here=index===chosen;
        return '<button class="step-chip'+(here?' active':'')+'" data-step-open="'+index+'" role="tab" aria-selected="'+(here?'true':'false')+'" aria-controls="lesson-step-'+block.id+'-'+index+'">'
          +'<span class="step-chip-num">'+(index+1)+'</span>'
          +'<span class="step-chip-text"><b>'+esc(step.title||'Untitled step')+'</b><span>'+stepKindLabel(step.kind)+'</span></span>'
          +'</button>';
      }).join('')
      +'<button class="add-task" data-add-step'+disabled+'>+ Add step</button></div>';
    return '<div class="lesson-builder" data-lesson-builder>'+rail+stepEditorHTML(block,steps[chosen],chosen,steps.length,disabled)+'</div>';
  }
  /* How a lesson reads when the project is being looked at rather than built:
     what it covers and how long it runs, not the machinery behind it. */
  function lessonCardHTML(block){
    var steps=lessonSteps(block), meta=lessonMeta(block);
    var asks=steps.filter(function(step){ return step.kind!=='explain'; }).length;
    var teaches=steps.filter(function(step){ return step.title||step.body; }).length;
    var counts=[];
    if(teaches)counts.push(teaches+(teaches===1?' section':' sections'));
    if(asks)counts.push(asks+(asks===1?' question':' questions'));
    return '<div class="lesson-card">'
      +'<div class="lesson-card-head">'
      +'<span class="lesson-dot" style="background:'+esc(meta.color)+'" aria-hidden="true">'+esc(meta.icon)+'</span>'
      +'<div><b>'+esc(meta.section||'Lesson')+'</b><span>'+esc(counts.join(' · ')||'Nothing in this lesson yet')+'</span></div>'
      +'</div>'
      +(meta.blurb?'<p class="lesson-card-blurb">'+esc(meta.blurb)+'</p>':'')
      +'<ol class="lesson-card-steps">'+steps.map(function(step,index){
        return '<li><span>'+(index+1)+'</span>'+esc(step.title||'Untitled step')+'</li>';
      }).join('')+'</ol>'
      +'</div>';
  }
  function lessonEditorHTML(block, disabled){
    return '<div class="lesson-shell" data-lesson-shell>'
      +lessonDetailsHTML(block,lessonMeta(block),disabled)
      +lessonBuilderHTML(block,disabled)
      +'</div>';
  }
  function lessonCard(block){ return root.querySelector('[data-block="'+block.id+'"]'); }
  function lessonDisabled(block){ return (readOnly||sectionLocked(block.sectionId))?' disabled':''; }
  function swapNode(node, html){
    if(!node||!node.parentNode)return null;
    var holder=document.createElement('div');
    holder.innerHTML=html;
    var next=holder.firstElementChild;
    node.parentNode.replaceChild(next,node);
    return next;
  }
  /* Redraw only the part that changed. A full render() rebuilds every card in
     the project, which replays each card's entry animation, so picking a step
     used to flash the whole block. */
  function refreshStepEditor(block){
    var card=lessonCard(block);
    if(!card)return render();
    var steps=lessonSteps(block), index=currentStep(block,steps.length);
    if(!swapNode(card.querySelector('.lesson-step'),stepEditorHTML(block,steps[index],index,steps.length,lessonDisabled(block))))return render();
    bindLessonCard(card,block);
  }
  function refreshLessonBuilder(block){
    var card=lessonCard(block);
    if(!card)return render();
    if(!swapNode(card.querySelector('[data-lesson-builder]'),lessonBuilderHTML(block,lessonDisabled(block))))return render();
    bindLessonCard(card,block);
  }
  function refreshLessonDetails(block){
    var card=lessonCard(block);
    if(!card)return render();
    if(!swapNode(card.querySelector('[data-lesson-details-region]'),lessonDetailsHTML(block,lessonMeta(block),lessonDisabled(block))))return render();
    bindLessonCard(card,block);
  }
  function refreshLessonShell(block){
    var card=lessonCard(block);
    if(!card)return render();
    if(!swapNode(card.querySelector('[data-lesson-shell]'),lessonEditorHTML(block,lessonDisabled(block))))return render();
    bindLessonCard(card,block);
  }
  function openLessonStep(block, index){
    var card=lessonCard(block);
    if(!card)return render();
    openStep[block.id]=index;
    card.querySelectorAll('[data-step-open]').forEach(function(chip){
      var here=+chip.getAttribute('data-step-open')===index;
      chip.classList.toggle('active',here);
      chip.setAttribute('aria-selected',here?'true':'false');
    });
    refreshStepEditor(block);
  }
  function moveStep(block, from, to){
    var steps=lessonSteps(block);
    if(to<0||to>=steps.length||from===to)return;
    block.steps=steps;
    block.steps.splice(to,0,block.steps.splice(from,1)[0]);
    openStep[block.id]=to;
    refreshLessonBuilder(block);
    queuedSave(block,true);
  }

  var CALLOUT_ICON='\uD83D\uDCA1';
  var CALLOUT_ICONS=['💡','⚠️','✅','📌','❗','🔥','⭐','📚'];
  var BLOCK_LABELS={note:'Note',tasks:'Task list',status:'Status',milestone:'Milestone',schedule:'Schedule',idea:'Idea inbox',lesson:'Practice lesson',table:'Table',image:'Image',quote:'Quote',callout:'Highlight',code:'Code',database:'Database'};
  /* The kinds whose content is text at heart, so one can become another with
     nothing lost on the way. A lesson, a table and an image are left out: their
     shape is the block, and there is nowhere for it to go. */
  var TURN_INTO=['note','idea','quote','callout','code','tasks','status','milestone','schedule'];
  function plainText(html){ var holder=document.createElement('div'); holder.innerHTML=html||''; return holder.textContent||''; }
  function textLines(html){
    var holder=document.createElement('div'); holder.innerHTML=html||'';
    var parts=holder.querySelectorAll('li,p,div,h1,h2,h3');
    var lines=parts.length?Array.prototype.map.call(parts,function(node){ return node.textContent||''; })
                          :String(holder.textContent||'').split('\n');
    return lines.map(function(line){ return line.trim(); }).filter(function(line){ return line; });
  }
  /* Turning a block into another kind keeps every field it arrived with: a task
     list that becomes a note still carries its items, so turning it back brings
     them with it, and an older version of the project restores as it was. */
  function turnInto(block, type){
    if(!block||block.type===type)return;
    var patch={ type:type };
    if(type!=='tasks'&&block.type==='tasks'&&!plainText(block.body).trim()){
      var written=(block.items||[]).filter(function(item){ return (item.text||'').trim(); });
      if(written.length)patch.body='<ul>'+written.map(function(item){ return '<li>'+esc(item.text)+'</li>'; }).join('')+'</ul>';
    }
    if(type==='tasks'&&!(block.items||[]).filter(function(item){ return (item.text||'').trim(); }).length){
      var lines=textLines(block.body);
      if(lines.length)patch.items=lines.map(function(text){ return { text:text, done:false }; });
    }
    if(type==='callout'&&!block.icon)patch.icon=CALLOUT_ICON;
    Object.assign(block,patch);
    render();
    queuedSave(block,true,patch);
  }
  function duplicateBlock(block){
    var copy=Object.assign({},block,{ id:id(), order:(block.order||Date.now())+0.5, pending:true });
    delete copy.updatedAt; delete copy.updatedBy;
    /* An uploaded picture belongs to one block: the copy shows the same address
       but does not own the file, so deleting either cannot take the other's
       picture with it. */
    if(copy.type==='image')copy.imageSlot='';
    blocks.push(copy);
    render();
    cloud().saveBlock(activeProject.id,copy.id,copy).then(function(){
      copy.pending=false;
      var card=root.querySelector('[data-block="'+copy.id+'"]');
      if(card){ card.classList.remove('is-pending'); var dot=card.querySelector('.save-dot'); if(dot)dot.remove(); }
    }).catch(function(){ copy.pending=false; });
  }
  function closeBlockMenu(){
    var open=root.querySelector('.block-menu');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
    document.removeEventListener('click',awayFromBlockMenu);
  }
  function awayFromBlockMenu(event){
    if(event.target.closest('.block-menu')||event.target.closest('[data-block-menu]'))return;
    closeBlockMenu();
  }
  /* Built when it is asked for and thrown away after, rather than rendered into
     the page: opening a menu is not a reason to rebuild every card. */
  function openBlockMenu(card, block){
    var already=card.querySelector('.block-menu');
    closeBlockMenu();
    if(already)return;
    var menu=document.createElement('div'); menu.className='block-menu';
    var rows=[];
    if(TURN_INTO.indexOf(block.type)>=0){
      rows.push('<div class="block-menu-head">Turn into</div>');
      TURN_INTO.forEach(function(type){ if(type!==block.type)rows.push('<button type="button" data-turn="'+type+'">'+BLOCK_LABELS[type]+'</button>'); });
    }
    rows.push('<div class="block-menu-head">This block</div><button type="button" data-duplicate>Duplicate</button>');
    menu.innerHTML=rows.join('');
    card.appendChild(menu);
    menu.querySelectorAll('[data-turn]').forEach(function(button){ button.onclick=function(){ closeBlockMenu(); turnInto(block,button.dataset.turn); }; });
    menu.querySelector('[data-duplicate]').onclick=function(){ closeBlockMenu(); duplicateBlock(block); };
    setTimeout(function(){ document.addEventListener('click',awayFromBlockMenu); },0);
  }
  /* Reached from the palette now rather than from a button per kind, so the
     making of a block lives in one place instead of inside a handler. */
  function addBlockOfType(type){
    if(!type||!activeProject)return;
    var block={id:id(),type:type,title:'',body:'',sectionId:activeSection==='all'?'':activeSection,pageId:activePage==='all'?'':activePage,order:Date.now(),done:false,due:'',pending:true,items:type==='tasks'?[{text:'',done:false}]:[],steps:type==='lesson'?[normalizeStep({kind:'explain',title:'What to know'}),normalizeStep({kind:'free'})]:[],lessonSection:type==='lesson'?sectionName(activeSection==='all'?'':activeSection):'',lessonBlurb:'',lessonIcon:type==='lesson'?'✦':'',lessonColor:type==='lesson'?LESSON_DEFAULT_COLOR:'',lessonHint:''};blocks.push(block);render();var card=root.querySelector('[data-block="'+block.id+'"]'), field=card&&card.querySelector('[data-title]');if(field)field.focus();cloud().saveBlock(activeProject.id,block.id,block).then(function(){block.pending=false;var current=root.querySelector('[data-block="'+block.id+'"]');if(current)current.classList.remove('is-pending');var dot=current&&current.querySelector('.save-dot');if(dot)dot.remove();}).catch(function(){block.pending=false;var current=root.querySelector('[data-block="'+block.id+'"]');if(current){current.classList.remove('is-pending');current.classList.add('save-failed');}});
  }
  var ADD_GROUPS=[
    { name:'Text', types:['note','quote','callout','code'] },
    { name:'Planning', types:['tasks','status','milestone','schedule'] },
    { name:'Thinking', types:['idea'] },
    { name:'Media', types:['image','table','database'] },
    { name:'Learning', types:['lesson'] }
  ];
  var BLOCK_BLURBS={ note:'Words, headings and lists', quote:'Someone else\u2019s words, set apart',
    callout:'A short thing worth noticing', code:'Monospaced, kept exactly as typed',
    tasks:'A list you can tick off', status:'Where something stands right now',
    milestone:'A date to work towards', schedule:'A time and what happens at it',
    idea:'Somewhere to put a thought before it goes', image:'A picture, uploaded or linked',
    table:'Rows and columns', database:'Rows with properties you choose', lesson:'Practice steps you can run' };
  function closeIconPicker(){
    var open=root.querySelector('.icon-picker');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
    document.removeEventListener('click',awayFromIconPicker);
  }
  function awayFromIconPicker(event){
    if(event.target.closest('.icon-picker')||event.target.closest('[data-callout-icon]'))return;
    closeIconPicker();
  }
  function closeTableDesign(){
    var open=root.querySelector('.table-design');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
    document.removeEventListener('click',awayFromTableDesign);
  }
  function awayFromTableDesign(event){
    if(event.target.closest('.table-design')||event.target.closest('[data-table-design]'))return;
    closeTableDesign();
  }
  function saveTableLook(card, block){
    var holder=card.querySelector('.block-table');
    if(holder)block.body=holder.innerHTML;
    queuedSave(block,true,{ body:block.body, tableHeader:!!block.tableHeader, tableZebra:!!block.tableZebra, tableDense:!!block.tableDense });
  }
  /* A header row is a row of th, not a flag: the table carries its own shape in
     its markup, so the switch rewrites the first row's cells and leaves the
     text inside them where it is. */
  function setTableHeader(card, block, on){
    var table=card.querySelector('.block-table table');
    var first=table&&table.rows[0];
    if(!first)return;
    Array.prototype.slice.call(first.cells).forEach(function(cell){
      var wanted=on?'TH':'TD';
      if(cell.tagName===wanted)return;
      var swapped=document.createElement(wanted);
      swapped.innerHTML=cell.innerHTML;
      if(cell.getAttribute('style'))swapped.setAttribute('style',cell.getAttribute('style'));
      cell.parentNode.replaceChild(swapped,cell);
    });
    block.tableHeader=!!on;
    saveTableLook(card,block);
  }
  /* Alignment is a property of cells, and the sanitiser keeps text-align on
     them for exactly this. With nothing selected it applies to the lot. */
  function alignTableCells(card, block, how){
    var holder=card.querySelector('.block-table');
    if(!holder)return;
    var chosen=holder.querySelectorAll('.selected-cell');
    if(!chosen.length)chosen=holder.querySelectorAll('th,td');
    Array.prototype.forEach.call(chosen,function(cell){ cell.style.textAlign=how; });
    saveTableLook(card,block);
  }
  function openTableDesign(card, block, anchor){
    var already=card.querySelector('.table-design');
    closeTableDesign();
    if(already)return;
    var holder=card.querySelector('.block-table');
    var panel=document.createElement('div'); panel.className='table-design';
    panel.innerHTML='<label><input type="checkbox" data-t-header'+(card.querySelector('.block-table th')?' checked':'')+'>Header row</label>'
      +'<label><input type="checkbox" data-t-zebra'+(block.tableZebra?' checked':'')+'>Striped rows</label>'
      +'<label><input type="checkbox" data-t-dense'+(block.tableDense?' checked':'')+'>Compact</label>'
      +'<div class="table-design-head">Align cells</div>'
      +'<div class="table-align"><button type="button" data-t-align="left">Left</button><button type="button" data-t-align="center">Centre</button><button type="button" data-t-align="right">Right</button></div>';
    anchor.parentNode.insertBefore(panel,anchor.nextSibling);
    panel.querySelector('[data-t-header]').onchange=function(event){ setTableHeader(card,block,event.target.checked); };
    panel.querySelector('[data-t-zebra]').onchange=function(event){
      block.tableZebra=event.target.checked;
      if(holder)holder.classList.toggle('zebra',block.tableZebra);
      saveTableLook(card,block);
    };
    panel.querySelector('[data-t-dense]').onchange=function(event){
      block.tableDense=event.target.checked;
      if(holder)holder.classList.toggle('dense',block.tableDense);
      saveTableLook(card,block);
    };
    panel.querySelectorAll('[data-t-align]').forEach(function(button){
      button.onclick=function(){ alignTableCells(card,block,button.dataset.tAlign); };
    });
    setTimeout(function(){ document.addEventListener('click',awayFromTableDesign); },0);
  }
  function taskCount(card, block){
    var holder=card.querySelector('.task-count');
    if(!holder)return;
    var written=(block.items||[]).filter(function(item){ return (item.text||'').trim(); });
    var left=written.filter(function(item){ return !item.done; }).length;
    holder.textContent=written.length?(left?left+' left of '+written.length:'all '+written.length+' done'):'';
  }
  function closeAddPalette(){
    var open=root.querySelector('.add-palette');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
    document.removeEventListener('click',awayFromAddPalette);
  }
  function awayFromAddPalette(event){
    if(event.target.closest('.add-palette')||event.target.closest('[data-add-open]'))return;
    closeAddPalette();
  }
  function addPaletteResults(holder, search){
    var wanted=String(search||'').trim().toLowerCase();
    var rows=[];
    ADD_GROUPS.forEach(function(group){
      var hits=group.types.filter(function(type){
        if(!wanted)return true;
        return (BLOCK_LABELS[type]+' '+(BLOCK_BLURBS[type]||'')+' '+type).toLowerCase().indexOf(wanted)>=0;
      });
      if(!hits.length)return;
      rows.push('<div class="add-group">'+group.name+'</div>');
      hits.forEach(function(type){
        rows.push('<button type="button" data-add="'+type+'"><b>'+BLOCK_LABELS[type]+'</b><small>'+esc(BLOCK_BLURBS[type]||'')+'</small></button>');
      });
    });
    holder.innerHTML=rows.length?rows.join(''):'<p class="add-empty">Nothing by that name.</p>';
    holder.querySelectorAll('[data-add]').forEach(function(button){
      button.onclick=function(){ closeAddPalette(); addBlockOfType(button.dataset.add); };
    });
  }
  /* One way in that answers to typing, rather than a row of buttons that grew
     by one every time a kind was added. */
  function openAddPalette(anchor){
    var already=root.querySelector('.add-palette');
    closeAddPalette();
    if(already)return;
    var palette=document.createElement('div'); palette.className='add-palette';
    palette.innerHTML='<input class="add-search" data-add-search type="search" placeholder="Search blocks\u2026" aria-label="Search blocks"><div class="add-results"></div>';
    anchor.parentNode.insertBefore(palette,anchor.nextSibling);
    var search=palette.querySelector('[data-add-search]'), results=palette.querySelector('.add-results');
    addPaletteResults(results,'');
    /* The row it hangs from is the last thing on the page, so a menu that only
       ever opened downwards would open off the bottom of it. */
    if(palette.getBoundingClientRect().bottom>window.innerHeight-8)palette.classList.add('above');
    search.oninput=function(){ addPaletteResults(results,search.value); };
    search.onkeydown=function(event){
      if(event.key==='Escape'){ closeAddPalette(); return; }
      if(event.key!=='Enter')return;
      var first=results.querySelector('[data-add]');
      if(first){ event.preventDefault(); first.click(); }
    };
    search.focus();
    setTimeout(function(){ document.addEventListener('click',awayFromAddPalette); },0);
  }
  /* ---------------------------------------------------------------- database
     A database is a block with a shape and a collection of rows. The shape —
     which properties there are and what kind each one is — lives in the block,
     because it is small and changes rarely. The rows live one document each in
     a collection beneath it, because they are many and change constantly.

     Every database in the project is watched, not only the ones on screen: a
     version saved while another section was showing still has to carry their
     rows, and a restore that could not see them would quietly throw them away. */
  var DB_KINDS=[['text','Text'],['number','Number'],['check','Tick box'],['select','Select']];
  var dbRows={}, dbWatch={};
  function isDatabase(block){ return !!block&&block.type==='database'; }
  function dbProps(block){
    return (Array.isArray(block.props)&&block.props.length) ? block.props : [{ id:'name', name:'Name', type:'text' }];
  }
  function dbRowsOf(blockId){ return dbRows[blockId]||[]; }
  function dbKindName(kind){
    var found=DB_KINDS.filter(function(pair){ return pair[0]===kind; })[0];
    return found?found[1]:'Text';
  }
  function mountDatabases(){
    if(!activeProject||!cloud().user)return;
    var wanted={};
    blocks.filter(isDatabase).forEach(function(block){ wanted[block.id]=true; });
    Object.keys(dbWatch).forEach(function(blockId){
      if(wanted[blockId])return;
      try{ dbWatch[blockId](); }catch(error){}
      delete dbWatch[blockId]; delete dbRows[blockId];
    });
    Object.keys(wanted).forEach(function(blockId){
      if(dbWatch[blockId])return;
      dbWatch[blockId]=cloud().watchRows(activeProject.id,blockId,function(list){
        dbRows[blockId]=list;
        /* One database's rows arrived, so one card is drawn again. */
        var card=root.querySelector('[data-block="'+blockId+'"]');
        var block=liveBlock(blockId);
        if(card&&block)paintDatabase(card,block);
      },function(){});
    });
  }
  function dropDatabases(){
    Object.keys(dbWatch).forEach(function(blockId){ try{ dbWatch[blockId](); }catch(error){} });
    dbWatch={}; dbRows={};
  }
  function dbValue(row, prop){
    var held=(row.values||{})[prop.id];
    return held===undefined||held===null?'':held;
  }
  function dbCellHTML(prop, row, frozen){
    var value=dbValue(row,prop), off=frozen?' disabled':'';
    if(prop.type==='check')
      return '<input type="checkbox" data-db-cell="'+prop.id+'"'+(value?' checked':'')+off+'>';
    if(prop.type==='select')
      return '<select class="db-pick" data-db-cell="'+prop.id+'"'+off+'><option value=""></option>'
        +(prop.options||[]).map(function(name){ return '<option'+(name===value?' selected':'')+'>'+esc(name)+'</option>'; }).join('')
        +'</select>';
    return '<input class="db-text" type="'+(prop.type==='number'?'number':'text')+'" data-db-cell="'+prop.id+'" value="'+esc(String(value))+'"'+off+'>';
  }
  function paintDatabase(card, block){
    var holder=card.querySelector('[data-db-table]');
    if(!holder)return;
    var frozen=readOnly||!canEdit()||sectionLocked(block.sectionId)||previewing();
    var props=dbProps(block), rows=dbRowsOf(block.id);
    holder.innerHTML='<div class="db-scroll"><table class="db-grid"><thead><tr>'
      +props.map(function(prop){
        return '<th data-db-head="'+prop.id+'"><button type="button" class="db-prop" data-db-prop="'+prop.id+'"'+(frozen?' disabled':'')+'>'+esc(prop.name||'Property')+'<small>'+esc(dbKindName(prop.type))+'</small></button></th>';
      }).join('')
      +(frozen?'':'<th class="db-slim"><button type="button" class="db-plus" data-db-add-prop aria-label="Add a property" title="Add a property">+</button></th>')
      +'</tr></thead><tbody>'
      +(rows.length?rows.map(function(row){
        return '<tr data-db-row="'+row.id+'">'
          +props.map(function(prop){ return '<td>'+dbCellHTML(prop,row,frozen)+'</td>'; }).join('')
          +(frozen?'':'<td class="db-slim"><button type="button" class="db-drop" data-db-row-remove aria-label="Delete this row">×</button></td>')
          +'</tr>';
      }).join(''):'<tr class="db-blank"><td colspan="'+(props.length+(frozen?0:1))+'">Nothing in here yet.</td></tr>')
      +'</tbody></table></div><div class="db-foot">'
      +(frozen?'':'<button type="button" class="db-new" data-db-add-row>+ New row</button>')
      +'<span class="db-count">'+rows.length+(rows.length===1?' row':' rows')+'</span></div>';
    if(!frozen)bindDatabase(card,block);
  }
  function dbSaveShape(block){
    block.props=dbProps(block).slice();
    queuedSave(block,true,{ props:block.props });
  }
  function dbWriteCell(block, rowId, prop, value){
    var row=dbRowsOf(block.id).filter(function(item){ return item.id===rowId; })[0];
    if(row){ row.values=row.values||{}; row.values[prop.id]=value; }
    var patch={}; patch[prop.id]=value;
    /* One cell, not the row: two people working in different columns of the
       same row must not put each other's work back. A merged write of a nested
       map leaves every other cell where it is. */
    cloud().patchRow(activeProject.id,block.id,rowId,{ values:patch }).catch(function(){});
  }
  function bindDatabase(card, block){
    var holder=card.querySelector('[data-db-table]');
    if(!holder)return;
    var props=dbProps(block);
    holder.querySelectorAll('[data-db-row]').forEach(function(line){
      var rowId=line.dataset.dbRow;
      line.querySelectorAll('[data-db-cell]').forEach(function(field){
        var prop=props.filter(function(item){ return item.id===field.dataset.dbCell; })[0];
        if(!prop)return;
        if(prop.type==='check'){ field.onchange=function(){ dbWriteCell(block,rowId,prop,field.checked); }; return; }
        if(prop.type==='select'){ field.onchange=function(){ dbWriteCell(block,rowId,prop,field.value); }; return; }
        field.onchange=function(){
          dbWriteCell(block,rowId,prop,prop.type==='number'?(field.value===''?'':Number(field.value)):field.value);
        };
      });
      var drop=line.querySelector('[data-db-row-remove]');
      if(drop)drop.onclick=async function(){
        if(!await askConfirm('Delete this row?','It goes for everyone this project is shared with.','Delete row'))return;
        dbRows[block.id]=dbRowsOf(block.id).filter(function(item){ return item.id!==rowId; });
        paintDatabase(card,block);
        cloud().removeRow(activeProject.id,block.id,rowId).catch(function(){});
      };
    });
    var add=holder.querySelector('[data-db-add-row]');
    if(add)add.onclick=function(){
      var rows=dbRowsOf(block.id);
      var last=rows.length?(rows[rows.length-1].order||0):0;
      var row={ id:id(), order:(last||Date.now())+1, values:{} };
      dbRows[block.id]=rows.concat(row);
      paintDatabase(card,block);
      cloud().saveRow(activeProject.id,block.id,row.id,{ order:row.order, values:{} }).catch(function(){});
      var field=card.querySelector('[data-db-row="'+row.id+'"] [data-db-cell]');
      if(field)field.focus();
    };
    var addProp=holder.querySelector('[data-db-add-prop]');
    if(addProp)addProp.onclick=async function(){
      var name=await askName('New property','e.g. Status','Add property');
      if(name===null)return;
      block.props=dbProps(block).concat({ id:id(), name:name.trim()||'Property', type:'text' });
      dbSaveShape(block);
      paintDatabase(card,block);
    };
    holder.querySelectorAll('[data-db-prop]').forEach(function(button){
      button.onclick=function(event){ event.stopPropagation(); openPropMenu(card,block,button); };
    });
  }
  function closePropMenu(){
    var open=root.querySelector('.db-menu');
    if(open&&open.parentNode)open.parentNode.removeChild(open);
    document.removeEventListener('click',awayFromPropMenu);
  }
  function awayFromPropMenu(event){
    if(event.target.closest('.db-menu')||event.target.closest('[data-db-prop]'))return;
    closePropMenu();
  }
  function openPropMenu(card, block, button){
    var already=root.querySelector('.db-menu');
    closePropMenu();
    if(already)return;
    var propId=button.dataset.dbProp;
    var prop=dbProps(block).filter(function(item){ return item.id===propId; })[0];
    if(!prop)return;
    var menu=document.createElement('div'); menu.className='db-menu';
    menu.innerHTML='<button type="button" data-prop-rename>Rename</button>'
      +(prop.type==='select'?'<button type="button" data-prop-options>Edit the choices</button>':'')
      +'<div class="db-menu-head">Kind</div>'
      +DB_KINDS.map(function(pair){
        return '<button type="button" data-prop-kind="'+pair[0]+'"'+(pair[0]===prop.type?' class="is-on"':'')+'>'+pair[1]+'</button>';
      }).join('')
      +'<div class="db-menu-head">Property</div><button type="button" class="danger" data-prop-drop>Delete</button>';
    /* On the card, not in the table: the rows scroll sideways inside their own
       box, and a menu opened inside it was cut off at its edge. */
    var frame=card.getBoundingClientRect(), spot=button.getBoundingClientRect();
    menu.style.left=Math.max(0,spot.left-frame.left)+'px';
    menu.style.top=(spot.bottom-frame.top+4)+'px';
    card.appendChild(menu);
    menu.querySelector('[data-prop-rename]').onclick=async function(){
      closePropMenu();
      var name=await askName('Rename property',prop.name||'Property','Rename');
      if(name===null)return;
      prop.name=name.trim()||prop.name;
      dbSaveShape(block); paintDatabase(card,block);
    };
    var options=menu.querySelector('[data-prop-options]');
    if(options)options.onclick=async function(){
      closePropMenu();
      var written=await askName('The choices, separated by commas',(prop.options||[]).join(', '),'Save choices');
      if(written===null)return;
      prop.options=written.split(',').map(function(part){ return part.trim(); }).filter(function(part){ return part; });
      dbSaveShape(block); paintDatabase(card,block);
    };
    menu.querySelectorAll('[data-prop-kind]').forEach(function(choice){
      choice.onclick=function(){
        closePropMenu();
        prop.type=choice.dataset.propKind;
        /* A select with nothing to select from is a dead end, so it starts with
           something in it that can be changed. */
        if(prop.type==='select'&&!(prop.options||[]).length)prop.options=['To do','Doing','Done'];
        dbSaveShape(block); paintDatabase(card,block);
      };
    });
    menu.querySelector('[data-prop-drop]').onclick=async function(){
      closePropMenu();
      if(dbProps(block).length<2){ await notify('This is the only property','A database keeps at least one.'); return; }
      if(!await askConfirm('Delete this property?','What is written in its column goes with it, for everyone.','Delete property'))return;
      block.props=dbProps(block).filter(function(item){ return item.id!==propId; });
      dbSaveShape(block); paintDatabase(card,block);
    };
    setTimeout(function(){ document.addEventListener('click',awayFromPropMenu); },0);
  }
  function taskRowHTML(item, index, frozen){
    var disabled=frozen?' disabled':'';
    return '<div class="task-row'+(item.done?' done':'')+'" data-task-row="'+index+'">'
      +(frozen?'':'<span class="task-grip" data-task-grip aria-hidden="true">\u283F</span>')
      +'<input type="checkbox" data-task-check="'+index+'" '+(item.done?'checked':'')+disabled+'>'
      +'<input class="task-text" data-task-text="'+index+'" value="'+esc(item.text)+'" placeholder="Task"'+disabled+'>'
      +(frozen?'':'<button type="button" class="task-drop" data-task-remove="'+index+'" aria-label="Remove this task">\u00d7</button>')
      +'</div>';
  }
  /* Positions are read back off the attributes, so after anything moves they
     have to say where things are now. */
  function renumberTasks(card){
    var rows=card.querySelectorAll('.task-row');
    Array.prototype.forEach.call(rows,function(row,index){
      row.dataset.taskRow=index;
      var check=row.querySelector('[data-task-check]'), text=row.querySelector('[data-task-text]'), drop=row.querySelector('[data-task-remove]');
      if(check)check.dataset.taskCheck=index;
      if(text)text.dataset.taskText=index;
      if(drop)drop.dataset.taskRemove=index;
    });
  }
  function saveTasks(card, block){
    taskCount(card,block);
    queuedSave(block,true,{items:block.items});
  }
  /* Adding, removing and moving a task all change one list on one card. None of
     them is a reason to draw the workspace again, so none of them does. */
  function bindTasks(card, block){
    var list=card.querySelector('[data-task-list]');
    if(!list)return;
    var frozen=!card.querySelector('[data-task-grip]');
    function rowAt(index){ return card.querySelector('.task-row[data-task-row="'+index+'"]'); }
    function focusTask(index, atEnd){
      var field=rowAt(index)&&rowAt(index).querySelector('[data-task-text]');
      if(!field)return;
      field.focus();
      if(atEnd){ try{ field.setSelectionRange(field.value.length,field.value.length); }catch(error){} }
    }
    function addTask(after){
      var at=typeof after==='number'?after+1:block.items.length;
      block.items.splice(at,0,{ text:'', done:false });
      var row=document.createElement('div');
      row.innerHTML=taskRowHTML(block.items[at],at,false);
      row=row.firstChild;
      var neighbour=rowAt(at);
      if(neighbour)list.insertBefore(row,neighbour); else list.appendChild(row);
      renumberTasks(card);
      bindTaskRow(card,block,row);
      focusTask(at,false);
      saveTasks(card,block);
    }
    function dropTask(index){
      if(block.items.length<2){ block.items=[{ text:'', done:false }]; var only=rowAt(0); if(only){ var field=only.querySelector('[data-task-text]'); if(field)field.value=''; only.classList.remove('done'); var tick=only.querySelector('[data-task-check]'); if(tick)tick.checked=false; } saveTasks(card,block); return; }
      block.items.splice(index,1);
      var row=rowAt(index);
      if(row&&row.parentNode)row.parentNode.removeChild(row);
      renumberTasks(card);
      focusTask(Math.max(0,index-1),true);
      saveTasks(card,block);
    }
    function bindTaskRow(card, block, row){
      var text=row.querySelector('[data-task-text]'), check=row.querySelector('[data-task-check]'), drop=row.querySelector('[data-task-remove]'), grip=row.querySelector('[data-task-grip]');
      if(text){
        text.oninput=function(){ block.items[+text.dataset.taskText].text=text.value; taskCount(card,block); queuedSave(block,false,{items:block.items}); };
        text.onkeydown=function(event){
          var at=+text.dataset.taskText;
          if(event.key==='Enter'){ event.preventDefault(); addTask(at); return; }
          if(event.key==='Backspace'&&!text.value){ event.preventDefault(); dropTask(at); }
        };
      }
      if(check)check.onchange=function(){
        block.items[+check.dataset.taskCheck].done=check.checked;
        row.classList.toggle('done',check.checked);
        saveTasks(card,block);
      };
      if(drop)drop.onclick=function(){ dropTask(+drop.dataset.taskRemove); };
      if(grip)bindTaskDrag(card,block,list,row,grip);
    }
    Array.prototype.forEach.call(card.querySelectorAll('.task-row'),function(row){ bindTaskRow(card,block,row); });
    var add=card.querySelector('[data-add-task]');
    if(add&&!frozen)add.onclick=function(){ addTask(); };
  }
  /* The same pointer handling the cards use: the row follows the pointer, the
     others make room, and the list is written down once at the end. A mouse, a
     finger and a pen all raise these, which the HTML5 drag events do not. */
  function bindTaskDrag(card, block, list, row, grip){
    grip.onpointerdown=function(event){
      if(event.button&&event.button!==0)return;
      event.preventDefault();
      var pointer=event.pointerId;
      var from=+row.dataset.taskRow;
      row.classList.add('is-dragging');
      try{ grip.setPointerCapture(pointer); }catch(error){}
      function others(){
        return Array.prototype.filter.call(list.children,function(node){ return node!==row&&node.classList.contains('task-row'); });
      }
      function move(step){
        var y=step.clientY;
        var moved=false;
        others().forEach(function(node){
          if(moved)return;
          var box=node.getBoundingClientRect(), middle=box.top+box.height/2;
          var before=node.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING;
          if(before&&y<middle){ list.insertBefore(row,node); moved=true; }
          else if(!before&&y>middle){ list.insertBefore(row,node.nextSibling); moved=true; }
        });
      }
      function stop(){
        grip.onpointermove=null; grip.onpointerup=null; grip.onpointercancel=null;
        try{ grip.releasePointerCapture(pointer); }catch(error){}
        row.classList.remove('is-dragging');
        var to=Array.prototype.indexOf.call(list.children,row);
        if(to>=0&&to!==from){
          var moved=block.items.splice(from,1)[0];
          block.items.splice(to,0,moved);
          renumberTasks(card);
          saveTasks(card,block);
        }
      }
      grip.onpointermove=move;
      grip.onpointerup=stop;
      grip.onpointercancel=stop;
    };
  }
  function blockHTML(block){
    var labels=BLOCK_LABELS;
    var prompt=block.type==='idea'?'Capture a possibility, question, or connection…':block.type==='lesson'?'Teach the idea in a few clear lines…':'Write something…';
    var frozen=readOnly||!canEdit()||sectionLocked(block.sectionId);
    var editable=frozen?'false':'true', disabled=frozen?' disabled':'';
    var body='<div class="block-body" data-body contenteditable="'+editable+'" data-placeholder="'+prompt+'">'+cleanHTML(block.body)+'</div>';
    var extra=((block.type==='schedule'||block.type==='milestone')?'<input class="block-date" data-date type="date" value="'+esc(block.due||'')+'">':'');
    if(block.type==='note') body='<div class="rich-tools"><button data-format="bold"><b>B</b></button><button data-format="italic"><i>I</i></button><button data-format="insertUnorderedList">• list</button><button data-format="formatBlock" data-value="H1">H1</button><button data-format="formatBlock" data-value="H2">H2</button><button data-format="formatBlock" data-value="H3">H3</button><button data-format="formatBlock" data-value="P">P</button></div>'+body;
    if(block.type==='tasks'){
      /* The handlers reach into items by index, so the list a card is drawn
         from has to be the list the block actually holds. */
      if(!Array.isArray(block.items)||!block.items.length)block.items=[{text:'',done:false}];
      var written=block.items.filter(function(item){ return (item.text||'').trim(); });
      var left=written.filter(function(item){ return !item.done; }).length;
      body='<div class="task-list" data-task-list>'+block.items.map(function(item,i){
        return taskRowHTML(item,i,frozen);
      }).join('')+'</div><div class="task-foot"><span class="task-count">'
        +(written.length?(left?left+' left of '+written.length:'all '+written.length+' done'):'')
        +'</span>'+(frozen?'':'<button class="add-task" data-add-task>+ Add task</button>')+'</div>';
    }
    if(block.type==='status') body='<select class="status-select" data-status'+disabled+'><option '+((block.status||'Not started')==='Not started'?'selected':'')+'>Not started</option><option '+((block.status||'Not started')==='In progress'?'selected':'')+'>In progress</option><option '+((block.status||'Not started')==='Blocked'?'selected':'')+'>Blocked</option><option '+((block.status||'Not started')==='Done'?'selected':'')+'>Done</option></select>';
    if(block.type==='idea') extra+='<select class="status-select idea-stage" data-idea-stage'+disabled+'><option '+((block.ideaStage||'Inbox')==='Inbox'?'selected':'')+'>Inbox</option><option '+((block.ideaStage||'Inbox')==='Exploring'?'selected':'')+'>Exploring</option><option '+((block.ideaStage||'Inbox')==='Kept'?'selected':'')+'>Kept</option><option '+((block.ideaStage||'Inbox')==='Dropped'?'selected':'')+'>Dropped</option></select>';
    if(block.type==='lesson'){
      if(frozen){
        body=lessonCardHTML(block);
        extra='<div class="lesson-actions"><button class="btn sm" data-practice-lesson>Practice this lesson</button></div>';
      } else {
        body=lessonEditorHTML(block,disabled);
        extra='<div class="lesson-actions"><button class="btn ghost sm" data-practice-lesson>Preview and practice</button><button class="btn ghost sm" data-export-lesson>Export</button><button class="btn ghost sm" data-import-lesson'+disabled+'>Import</button></div>';
      }
    }
    if(block.type==='table') body='<div class="table-tools"><span>Drag across cells to select a row or a column</span>'+(frozen?'':'<button data-table-design>Design</button><span class="table-selection" data-table-selection hidden><b>Selected</b><button type="button" data-remove-row>Delete row</button><button type="button" data-remove-col>Delete column</button></span>')+'</div><div class="table-frame"><div class="block-body block-table'+(block.tableZebra?' zebra':'')+(block.tableDense?' dense':'')+'" data-body contenteditable="'+editable+'" data-placeholder="Create a simple table…">'+(block.body?cleanHTML(block.body):TABLE_DEFAULT)+'</div><div class="table-resizers"></div>'+(frozen?'':'<button type="button" class="table-add table-add-col" data-table-col title="Add a column" aria-label="Add a column">+</button><button type="button" class="table-add table-add-row" data-table-row title="Add a row" aria-label="Add a row">+</button>')+'</div>';
    if(block.type==='image'){
      var picker='<input data-image-upload type="file" accept="image/jpeg,image/png,image/webp" hidden>';
      body=(block.imageUrl
        ? '<div class="image-preview"><img src="'+esc(block.imageUrl)+'" alt=""></div>'
          +(frozen?'':'<div class="image-tools"><label class="image-swap">Replace'+picker+'</label><button type="button" class="image-swap" data-image-clear>Remove</button></div>')
        : (frozen
          ? '<div class="image-preview">No image yet.</div>'
          : '<label class="image-drop" data-image-drop><span class="image-drop-mark" aria-hidden="true">+</span><b>Choose an image</b><small>or drop one here · JPEG, PNG, WebP up to 1.5 MB</small>'+picker+'</label>'))
        +(frozen?'':'<input class="image-url" data-image-url value="'+esc(block.imageUrl||'')+'" placeholder="or paste an image address">');
    }
    if(block.type==='quote') body='<blockquote class="block-quote" data-body contenteditable="'+editable+'" data-placeholder="Worth keeping in someone else\u2019s words\u2026">'+cleanHTML(block.body)+'</blockquote>';
    if(block.type==='callout') body='<div class="callout-row"><button type="button" class="callout-icon" data-callout-icon'+disabled+' title="Change the icon">'+esc(block.icon||CALLOUT_ICON)+'</button><div class="block-body" data-body contenteditable="'+editable+'" data-placeholder="Something to keep in view\u2026">'+cleanHTML(block.body)+'</div></div>';
    /* Code is text, not markup: it is kept and shown as what was typed, so a
       stray angle bracket stays a stray angle bracket. */
    if(block.type==='database') body='<div class="db" data-db-table></div>';
    if(block.type==='code') body='<pre class="block-code" data-code contenteditable="'+editable+'" spellcheck="false" data-placeholder="Paste or write code\u2026">'+esc(plainText(block.body))+'</pre>';
    return '<article class="studio-block '+block.type+(block.done?' done':'')+(block.pending?' is-pending':'')+'" data-block="'+block.id+'"><button class="drag-handle" data-drag title="Drag to reorder" aria-label="Drag to reorder"'+disabled+'>⠿</button><button class="block-delete" data-delete aria-label="Delete block"'+disabled+'>×</button>'+(frozen?'':'<button type="button" class="block-more" data-block-menu aria-label="More for this block" title="Turn into, duplicate">⋯</button>')+'<div class="block-kicker">'+(labels[block.type]||'Block')+' · '+esc(sectionName(block.sectionId||''))+(block.pending?'<span class="save-dot">Saving</span>':'')+'</div><input class="block-title" data-title value="'+esc(block.title||'')+'" placeholder="Untitled '+(labels[block.type]||'block').toLowerCase()+'"'+disabled+'>'+body+extra+'</article>';
  }
  function queuedSave(block, immediate, patch){
    var old=saveTimers[block.id]; if(old) clearTimeout(old);
    /* Coalesce only the fields that changed. This means another editor can
       update the body while this person is changing the title without either
       write putting an older copy of the other field back into Firestore. */
    savePatches[block.id]=Object.assign(savePatches[block.id]||{},patch||block);
    if(previewing())return;
    var commit=function(){
      var changes=savePatches[block.id]||block;
      delete saveTimers[block.id]; delete savePatches[block.id];
      markShown();
      var writer=cloud().patchBlock||cloud().saveBlock;
      var landed=holdInFlight(block.id,changes);
      writer(activeProject.id,block.id,changes).then(landed,landed);
    };
    if(immediate) commit(); else saveTimers[block.id]=setTimeout(commit,70);
  }
  function shuffled(list){
    var copy=list.slice();
    for(var i=copy.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)), swap=copy[i]; copy[i]=copy[j]; copy[j]=swap; }
    return copy;
  }
  /* Turns the block into the same unit shape a published course hands to
     CrowQuiz: a titled section teaches, its practice line previews the drill,
     and the hint button answers with the lesson's own hint. */
  function lessonUnit(block){
    var steps=lessonSteps(block), meta=lessonMeta(block);
    var built=steps.map(function(step, index){
      var gens=[];
      var picks=step.options.filter(function(option){ return option!==''; });
      if(step.kind==='choice'&&picks.length){
        gens=[function(){
          var choices=shuffled(picks);
          return { type:'mcq', tag:step.title||'Practice', headline:step.prompt||'Choose an answer', sub:'Choose the best answer.',
            choices:choices, correctIndex:Math.max(0,choices.indexOf(step.answer)),
            explain:step.answer?'Correct answer: '+step.answer:'' };
        }];
      }
      if(step.kind==='free'&&(step.prompt||step.answer)){
        gens=[function(){
          return { type:'type', tag:step.title||'Practice', headline:step.prompt||'Write your answer', sub:'Answer from memory.',
            answer:step.answer||'', alts:[step.answer||''], explain:step.answer?'Correct answer: '+step.answer:'' };
        }];
      }
      var teaches=!!(step.title||step.body);
      return {
        title:teaches?(step.title||'Step '+(index+1)):'',
        body:step.body||'',
        practice:step.practice||'',
        questions:gens.length?1:0,
        gens:gens
      };
    });
    var questions=built.reduce(function(total, step){ return total+step.questions; }, 0);
    if(!questions&&!built.some(function(step){ return step.title; })){
      built=[{ title:block.title||'Practice lesson', body:'This lesson has no teaching text or questions yet. Add them in Edit mode.', practice:'', questions:0, gens:[] }];
    }
    return {
      unit:{
        id:'lesson-'+block.id,
        title:block.title||'Practice lesson',
        blurb:meta.blurb||'a lesson you wrote in Studio',
        color:meta.color,
        icon:meta.icon,
        hint:meta.hint||'Re-read the section this question came from, then answer from what it taught.',
        steps:built
      },
      section:meta.section,
      questions:questions
    };
  }
  function launchStudioPractice(block){
    var lesson=lessonUnit(block), shade=document.createElement('div'), host=document.createElement('div'), close=document.createElement('button');
    shade.className='studio-practice-overlay';host.className='studio-practice-host';close.className='iconbtn studio-practice-close';close.innerHTML='&times;';close.setAttribute('aria-label','Close lesson');shade.appendChild(close);shade.appendChild(host);document.body.appendChild(shade);
    close.onclick=function(){shade.remove();};shade.onclick=function(event){if(event.target===shade)shade.remove();};
    var rootId='studio-practice-'+id();host.id=rootId;
    CrowQuiz({
      course:'studio_'+activeProject.id+'_'+block.id,
      title:block.title||'Practice lesson',
      tagline:lesson.section?lesson.section+' · Studio lesson':'Studio lesson',
      units:[lesson.unit],
      perStep:1, reviewQs:0, mixedCount:Math.max(1,lesson.questions), hearts:3
    }).start('#'+rootId);
    /* Studio practice opens straight into the one lesson, so the course home
       behind it is a dead end. Every way out of the session leaves the overlay
       instead, and says where it goes. */
    var leave=function(){ shade.remove(); };
    var quit=host.querySelector('[data-f="quit"]');if(quit)quit.onclick=leave;
    var back=host.querySelector('[data-f="home"]');
    if(back){ back.textContent='Back to project'; back.onclick=leave; }
    var unitButton=host.querySelector('.unit');if(unitButton)unitButton.click();
  }
  function bindLessonCard(card, block){
    block.steps=lessonSteps(block);
    var locked=!!lessonDisabled(block);
    var bindMeta=function(selector, key, immediate){
      var field=card.querySelector(selector);
      if(!field)return;
      field[immediate?'onchange':'oninput']=function(e){
        block[key]=e.target.value;
        queuedSave(block,!!immediate);
        if(key==='lessonColor'||key==='lessonIcon'){
          var dot=card.querySelector('.lesson-dot');
          if(dot){ dot.style.background=lessonMeta(block).color; dot.textContent=lessonMeta(block).icon; }
        }
      };
    };
    bindMeta('[data-lesson-section]','lessonSection');
    bindMeta('[data-lesson-blurb]','lessonBlurb');
    bindMeta('[data-lesson-icon]','lessonIcon');
    bindMeta('[data-lesson-hint]','lessonHint');
    bindMeta('[data-lesson-color]','lessonColor',true);
    var bindStep=function(attribute, key, read){
      card.querySelectorAll('[data-step-'+attribute+']').forEach(function(input){
        input.oninput=function(e){ block.steps[+e.target.getAttribute('data-step-'+attribute)][key]=read?read(e.target.value):e.target.value; queuedSave(block); };
      });
    };
    /* The rail is the only place a step's name shows, so keep it in step with
       the field rather than waiting for the next redraw. */
    card.querySelectorAll('[data-step-title]').forEach(function(input){
      input.oninput=function(e){
        var index=+e.target.getAttribute('data-step-title');
        block.steps[index].title=e.target.value;
        var chip=card.querySelector('[data-step-open="'+index+'"] .step-chip-text b');
        if(chip)chip.textContent=e.target.value||'Untitled step';
        queuedSave(block);
      };
    });
    bindStep('body','body');
    bindStep('practice','practice');
    bindStep('prompt','prompt');
    bindStep('answer','answer');
    card.querySelectorAll('[data-choice-text]').forEach(function(input){
      input.oninput=function(e){
        var step=block.steps[+e.target.getAttribute('data-choice-text')], slot=+e.target.getAttribute('data-choice-slot');
        var was=step.options[slot];
        step.options[slot]=e.target.value;
        /* The correct answer is stored by value, so follow a rename. */
        if(step.answer===was)step.answer=e.target.value;
        queuedSave(block);
      };
    });
    card.querySelectorAll('[data-choice-correct]').forEach(function(input){
      input.onchange=function(e){
        var step=block.steps[+e.target.getAttribute('data-choice-correct')];
        step.answer=step.options[+e.target.value]||'';
        queuedSave(block,true);
      };
    });
    card.querySelectorAll('[data-add-choice]').forEach(function(button){
      button.onclick=function(){ block.steps[+button.getAttribute('data-add-choice')].options.push(''); refreshStepEditor(block); queuedSave(block,true); };
    });
    card.querySelectorAll('[data-remove-choice]').forEach(function(button){
      button.onclick=function(){
        var step=block.steps[+button.getAttribute('data-remove-choice')], slot=+button.getAttribute('data-choice-slot');
        if(step.options.length<3)return;
        if(step.answer===step.options[slot])step.answer='';
        step.options.splice(slot,1);
        refreshStepEditor(block); queuedSave(block,true);
      };
    });
    card.querySelectorAll('[data-step-kind]').forEach(function(input){
      input.onchange=function(e){ block.steps[+e.target.dataset.stepKind].kind=e.target.value; refreshLessonBuilder(block); queuedSave(block,true); };
    });
    card.querySelectorAll('[data-move-step]').forEach(function(button){
      button.onclick=function(){ moveStep(block,+button.getAttribute('data-move-step'),+button.getAttribute('data-move-to')); };
    });
    card.querySelectorAll('[data-remove-step]').forEach(function(button){
      button.onclick=function(){
        if(block.steps.length<2)return;
        var gone=+button.dataset.removeStep;
        block.steps.splice(gone,1);
        openStep[block.id]=Math.max(0,Math.min(gone,block.steps.length-1));
        refreshLessonBuilder(block); queuedSave(block,true);
      };
    });
    var addStep=card.querySelector('[data-add-step]');
    if(addStep)addStep.onclick=function(){ block.steps.push(normalizeStep({kind:'explain'})); openStep[block.id]=block.steps.length-1; refreshLessonBuilder(block); queuedSave(block,true); };
    card.querySelectorAll('[data-step-open]').forEach(function(button){
      button.onclick=function(){ openLessonStep(block,+button.getAttribute('data-step-open')); };
    });
    var detailsToggle=card.querySelector('[data-lesson-details]');
    if(detailsToggle)detailsToggle.onclick=function(){ openDetails[block.id]=!openDetails[block.id]; refreshLessonDetails(block); };
    var preview=card.querySelector('[data-practice-lesson]');
    if(preview)preview.onclick=function(){ launchStudioPractice(block); };
    var exportLesson=card.querySelector('[data-export-lesson]');
    if(exportLesson)exportLesson.onclick=function(){ downloadJSON(safeName(block.title||'lesson')+'-lesson',lessonPayload(block)); };
    var importLesson=card.querySelector('[data-import-lesson]');
    if(importLesson)importLesson.onclick=async function(){
      var payload=await readJSONFile();
      if(!payload)return;
      if(payload.__broken||payload.crowstudies!=='lesson'||!payload.lesson)
        return notify('That file could not be imported','Choose a .json file exported from a Studio lesson with Export.');
      if(!await askConfirm('Replace this lesson?','\u201c'+(payload.lesson.title||'The imported lesson')+'\u201d will replace everything in this block.','Replace lesson'))return;
      applyLessonPayload(block,payload.lesson);
      openStep[block.id]=0;
      var titleField=card.querySelector('[data-title]');
      if(titleField)titleField.value=block.title;
      refreshLessonShell(block);
      queuedSave(block,true);
    };
    bindStepDrag(card,block,locked);
  }
  /* Drag a step row to reorder. Pointer events rather than HTML5
     drag-and-drop, which never landed a drop inside this scrolling rail.
     The move is tracked on the window, so releasing the mouse outside the
     narrow rail still finishes the drag instead of stranding it. The arrows in
     the step header do the same job without a pointer. */
  function bindStepDrag(card, block, locked){
    var rail=card.querySelector('.step-rail');
    if(!rail)return;
    rail.classList.toggle('is-locked',!!locked);
    if(locked||rail.dataset.dragBound)return;
    rail.dataset.dragBound='1';
    var lifted=null, armed=null, pointer=null, startX=0, startY=0;

    /* Same damping as the block grid: a row that has just moved does not get
       to move again until the pointer has gone somewhere. */
    var HOLD=4, anchorX=0, anchorY=0, lastX=0, lastY=0, cameFrom=null, hasMoved=false;
    function place(x, y, exact){
      if(!lifted)return;
      var others=Array.prototype.slice.call(rail.querySelectorAll('.step-chip:not(.dragging)'));
      if(!others.length)return;
      var sideways=String(getComputedStyle(rail).gridAutoFlow).indexOf('column')>=0;
      var nearest=null, closest=Infinity;
      others.forEach(function(chip){
        var box=chip.getBoundingClientRect();
        var gap=sideways?Math.abs(x-(box.left+box.width/2)):Math.abs(y-(box.top+box.height/2));
        if(gap<closest){ closest=gap; nearest=chip; }
      });
      if(!nearest)return;
      var box=nearest.getBoundingClientRect();
      var before=sideways?x<box.left+box.width/2:y<box.top+box.height/2;
      var mark=before?nearest:nearest.nextSibling;
      if(mark===lifted.nextSibling)return;
      if(hasMoved&&!exact){
        var travel=Math.abs(x-anchorX)+Math.abs(y-anchorY);
        if(travel<HOLD)return;
      }
      cameFrom=lifted.nextSibling;
      rail.insertBefore(lifted,mark);
      anchorX=x; anchorY=y; hasMoved=true;
    }
    /* Read the new order off the rows once, then draw the rail back from the
       lesson. Deriving the list from state in both directions means what is on
       screen can never drift from what was saved, whatever happened during the
       drag. */
    function finish(){
      var chips=Array.prototype.slice.call(rail.querySelectorAll('.step-chip'));
      var order=chips.map(function(chip){ return +chip.getAttribute('data-step-open'); });
      lifted.classList.remove('dragging');
      rail.classList.remove('is-reordering');
      lifted=null;
      var sound=order.length===block.steps.length&&order.every(function(from){ return from>=0&&from<block.steps.length; });
      if(sound&&!order.every(function(from,to){ return from===to; })){
        var wasOpen=currentStep(block,block.steps.length);
        block.steps=order.map(function(from){ return block.steps[from]; });
        openStep[block.id]=Math.max(0,order.indexOf(wasOpen));
        queuedSave(block,true);
      }
      refreshLessonBuilder(block);
    }
    function onMove(event){
      if(!armed||(pointer!==null&&event.pointerId!==pointer))return;
      if(event.buttons===0){ release(event); return; }
      if(!lifted){
        /* A little slack, so a plain click still opens the step. */
        if(Math.abs(event.clientX-startX)<4&&Math.abs(event.clientY-startY)<4)return;
        lifted=armed;
        lifted.classList.add('dragging');
        rail.classList.add('is-reordering');
        cameFrom=null; hasMoved=false; anchorX=event.clientX; anchorY=event.clientY;
      }
      event.preventDefault();
      lastX=event.clientX; lastY=event.clientY;
      place(event.clientX,event.clientY);
    }
    function release(event){
      if(pointer!==null&&event&&event.pointerId!==undefined&&event.pointerId!==pointer)return;
      window.removeEventListener('pointermove',onMove,true);
      window.removeEventListener('pointerup',release,true);
      window.removeEventListener('pointercancel',release,true);
      armed=null; pointer=null;
      if(!lifted)return;
      if(event&&event.clientX!==undefined){ lastX=event.clientX; lastY=event.clientY; }
      place(lastX,lastY,true);
      finish();
    }
    rail.addEventListener('pointerdown',function(event){
      if(event.button!==0)return;
      var chip=event.target.closest('.step-chip');
      if(!chip||!rail.contains(chip))return;
      armed=chip; pointer=event.pointerId; startX=event.clientX; startY=event.clientY;
      window.addEventListener('pointermove',onMove,true);
      window.addEventListener('pointerup',release,true);
      window.addEventListener('pointercancel',release,true);
    });
  }
  /* Tables behave like the ones in Notion: drag across cells to select a block
     of them, the tool buttons act on that whole selection, and the dividers
     between header cells drag to set column widths. */
  function bindTable(card, block){
    var frame=card.querySelector('.table-frame'), wrap=card.querySelector('.block-table');
    if(!frame||!wrap)return;
    var bar=frame.querySelector('.table-resizers');
    var table=wrap.querySelector('table');
    if(!table){ wrap.innerHTML=TABLE_DEFAULT; table=wrap.querySelector('table'); }
    normalizeTable(table);
    var picked=null, dragging=false, locked=readOnly||sectionLocked(block.sectionId);

    function paint(){
      Array.prototype.forEach.call(table.querySelectorAll('.selected-cell'),function(cell){ cell.classList.remove('selected-cell'); });
      var span=spanOf(picked);
      /* Taking a row or a column away is about the one you are pointing at, so
         it is offered where the pointing happens and nowhere else. */
      var chooser=card.querySelector('[data-table-selection]');
      if(chooser)chooser.hidden=!span;
      if(!span)return;
      for(var r=span.top;r<=span.bottom;r++){
        var row=table.rows[r];
        if(!row)continue;
        for(var c=span.left;c<=span.right;c++){ if(row.cells[c])row.cells[c].classList.add('selected-cell'); }
      }
    }
    function layout(){
      if(!bar)return;
      var header=table.rows[0];
      if(!header){ bar.innerHTML=''; return; }
      var needed=Math.max(0,header.cells.length-1);
      while(bar.children.length>needed)bar.removeChild(bar.lastChild);
      while(bar.children.length<needed)bar.appendChild(document.createElement('div'));
      Array.prototype.forEach.call(bar.children,function(handle,index){
        handle.className='col-resizer';
        handle.dataset.edge=String(index);
        handle.title='Drag to resize this column';
        handle.style.left=(header.cells[index].offsetLeft+header.cells[index].offsetWidth-wrap.scrollLeft)+'px';
      });
    }
    function store(){ block.body=cleanHTML(wrap.innerHTML); queuedSave(block,true); }
    function commit(){ normalizeTable(table); paint(); layout(); store(); }
    function span(){
      var found=spanOf(picked);
      if(found)return found;
      var last=Math.max(0,table.rows.length-1), edge=Math.max(0,tableColumns(table)-1);
      return { top:last, bottom:last, left:edge, right:edge };
    }

    wrap.addEventListener('pointerdown',function(event){
      var cell=event.target.closest('th,td');
      if(!cell||!table.contains(cell))return;
      var spot=cellSpot(cell);
      picked=(event.shiftKey&&picked)?{from:picked.from,to:spot}:{from:spot,to:spot};
      dragging=!locked;
      paint();
    });
    wrap.addEventListener('pointerover',function(event){
      if(!dragging||!event.buttons||!picked)return;
      var cell=event.target.closest('th,td');
      if(!cell||!table.contains(cell))return;
      var spot=cellSpot(cell);
      if(picked.to.row===spot.row&&picked.to.column===spot.column)return;
      picked={from:picked.from,to:spot};
      /* Without this the browser paints its own text selection over the cells. */
      wrap.classList.add('is-selecting');
      var native=window.getSelection();
      if(native)native.removeAllRanges();
      paint();
    });
    ['pointerup','pointercancel'].forEach(function(name){
      wrap.addEventListener(name,function(){ dragging=false; wrap.classList.remove('is-selecting'); });
    });
    wrap.addEventListener('scroll',layout);

    function addRow(){
      var at=span().bottom+1, host=table.tBodies[0]||table, row=document.createElement('tr');
      for(var i=0;i<tableColumns(table);i++)row.appendChild(document.createElement('td'));
      host.insertBefore(row,table.rows[at]||null);
      picked={from:{row:at,column:0},to:{row:at,column:Math.max(0,tableColumns(table)-1)}};
      commit();
    }
    function addColumn(){
      var at=span().right+1, group=table.querySelector('colgroup');
      Array.prototype.forEach.call(table.rows,function(row,index){
        row.insertBefore(document.createElement(index===0?'th':'td'),row.cells[at]||null);
      });
      var widths=columnWidths(table), share=100/(widths.length+1);
      widths=widths.map(function(width){ return width*(1-share/100); });
      widths.splice(at,0,share);
      group.insertBefore(document.createElement('col'),group.children[at]||null);
      setColumnWidths(table,widths);
      picked={from:{row:0,column:at},to:{row:Math.max(0,table.rows.length-1),column:at}};
      commit();
    }
    function removeRows(){
      var area=span();
      if(table.rows.length-(area.bottom-area.top+1)<1)return;
      for(var r=area.bottom;r>=area.top;r--){
        var row=table.rows[r];
        if(row)row.parentNode.removeChild(row);
      }
      picked=null;
      commit();
    }
    function removeColumns(){
      var area=span(), group=table.querySelector('colgroup');
      if(tableColumns(table)-(area.right-area.left+1)<1)return;
      Array.prototype.forEach.call(table.rows,function(row){
        for(var c=area.right;c>=area.left;c--){ if(row.cells[c])row.deleteCell(c); }
      });
      for(var i=area.right;i>=area.left;i--){ if(group.children[i])group.removeChild(group.children[i]); }
      picked=null;
      commit();
    }
    var tools=[['[data-table-row]',addRow],['[data-table-col]',addColumn],['[data-remove-row]',removeRows],['[data-remove-col]',removeColumns]];
    tools.forEach(function(pair){
      var button=card.querySelector(pair[0]);
      if(button)button.onclick=pair[1];
    });

    if(bar)bar.addEventListener('pointerdown',function(event){
      var handle=event.target.closest('.col-resizer');
      if(!handle||locked)return;
      event.preventDefault();
      var index=+handle.dataset.edge, header=table.rows[0];
      if(!header||!header.cells[index+1])return;
      var start=Array.prototype.map.call(header.cells,function(cell){ return cell.getBoundingClientRect().width; });
      var startX=event.clientX, least=56;
      handle.setPointerCapture(event.pointerId);
      wrap.classList.add('is-resizing');
      var move=function(moved){
        var shift=Math.max(least-start[index],Math.min(start[index+1]-least,moved.clientX-startX));
        var next=start.slice();
        next[index]=start[index]+shift;
        next[index+1]=start[index+1]-shift;
        setColumnWidths(table,next);
        layout();
      };
      var done=function(){
        handle.removeEventListener('pointermove',move);
        handle.removeEventListener('pointerup',done);
        handle.removeEventListener('pointercancel',done);
        wrap.classList.remove('is-resizing');
        store();
      };
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',done);
      handle.addEventListener('pointercancel',done);
    });

    if(window.ResizeObserver)new window.ResizeObserver(layout).observe(wrap);
    layout();
  }
  function bindSectionMenu(scope){
    scope.querySelectorAll('[data-add-page]').forEach(function(button){button.onclick=async function(){var title=await askName('New page','e.g. Basics','Add page');if(!title||!title.trim())return;var section=findSection(button.dataset.addPage);section.pages=(section.pages||[]).concat({id:id(),title:title.trim()});activeSection=section.id;activePage=section.pages[section.pages.length-1].id;openSectionMenu='';await cloud().saveProject(activeProject.id,{sections:activeProject.sections});render();};});
    scope.querySelectorAll('[data-lock-section]').forEach(function(button){button.onclick=async function(){var section=findSection(button.dataset.lockSection);section.locked=!section.locked;openSectionMenu='';await cloud().saveProject(activeProject.id,{sections:activeProject.sections});render();};});
    scope.querySelectorAll('[data-remove-section]').forEach(function(button){button.onclick=async function(){var section=findSection(button.dataset.removeSection);if(!await askConfirm('Delete section?', 'Its blocks will stay in the project under Unsorted.', 'Delete section'))return;blocks.forEach(function(block){if(block.sectionId===section.id){block.sectionId='';block.pageId='';cloud().saveBlock(activeProject.id,block.id,block).catch(function(){});}});activeProject.sections=activeProject.sections.filter(function(item){return item.id!==section.id;});activeSection='all';activePage='all';openSectionMenu='';await cloud().saveProject(activeProject.id,{sections:activeProject.sections});render();};});
  }
  function bind(){
    /* The list and its handle belong to the shell, not to the project view, so
       they are wired before anything that leaves early: the settings page and
       the loading frame both draw the handle too, and both used to draw it
       dead. */
    root.querySelectorAll('[data-side-toggle]').forEach(function(button){ button.onclick=function(){ setSide(!sideOpen); }; });
    var sideScrim=root.querySelector('[data-side-close]');
    if(sideScrim)sideScrim.onclick=function(){ setSide(false); };
    root.querySelectorAll('[data-new-project]').forEach(function(button){button.onclick=async function(){var title=await askName('New project','e.g. Learn Mandarin','Create project');if(title===null)return;button.disabled=true;try{var projectId=await cloud().createProject(title.trim()||'Untitled project');await loadProjects(projectId);}finally{button.disabled=false;}};});
    root.querySelectorAll('[data-project]').forEach(function(button){button.onclick=function(){view='project';if(narrow())sideOpen=false;loadProject(button.dataset.project);};});
    root.querySelectorAll('[data-project-settings]').forEach(function(button){button.onclick=function(){
      var wanted=button.dataset.projectSettings;
      view='settings';
      if(narrow())sideOpen=false;
      /* Settings for a project you are not in still has to open that project,
         because that is what the page is describing. */
      if(wanted&&(!activeProject||activeProject.id!==wanted))loadProject(wanted);
      else renderSwitch();
    };});
    root.querySelectorAll('[data-import-project]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{ await importProjectFile(); }finally{ button.disabled=false; }};});
    root.querySelectorAll('[data-example-project]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{ rememberExample(); await addExampleProject(); }finally{ button.disabled=false; }};});
    if(!activeProject)return;
    if(view==='settings'){
      root.querySelector('[data-settings-back]').onclick=function(){view='project';renderSwitch();};
      root.querySelector('[data-save-project-name]').onclick=async function(){var input=root.querySelector('[data-project-name]'), title=input.value.trim();if(!title)return;activeProject.title=title;await cloud().saveProject(activeProject.id,{title:title,sections:activeProject.sections||[]});await loadProjects(activeProject.id);view='settings';render();};
      root.querySelectorAll('[data-delete-section]').forEach(function(button){button.onclick=async function(){var sectionId=button.dataset.deleteSection, section=(activeProject.sections||[]).filter(function(s){return s.id===sectionId;})[0];if(!await askConfirm('Delete section?', '“'+(section?section.title:'This section')+'” will be removed. Its blocks will stay in the project under Unsorted.', 'Delete section'))return;blocks.forEach(function(block){if(block.sectionId===sectionId){block.sectionId='';cloud().saveBlock(activeProject.id,block.id,block).catch(function(){});}});activeProject.sections=(activeProject.sections||[]).filter(function(s){return s.id!==sectionId;});if(activeSection===sectionId)activeSection='all';await cloud().saveProject(activeProject.id,{sections:activeProject.sections});render();};});
      var inviteButton=root.querySelector('[data-send-invite]');
      if(inviteButton)inviteButton.onclick=async function(){
        var field=root.querySelector('[data-invite-username]');
        var role=root.querySelector('[data-invite-role]').value;
        var address=String(field.value||'').trim().toLowerCase();
        if(!/^[a-z0-9_]{3,20}$/.test(address))return notify('That username does not look right','Enter their CrowStudies username.');
        inviteButton.disabled=true;
        try{
          await cloud().invite(activeProject.id,address,role);
          field.value='';
          await notify('Access granted','“'+address+'” can now open this project in Studio.');
        }catch(error){
          await notify('That could not be shared','Check the username and make sure you own this project.');
        }finally{ inviteButton.disabled=false; }
      };
      root.querySelectorAll('[data-remove-member]').forEach(function(button){
        button.onclick=async function(){
          var uid=button.getAttribute('data-remove-member');
          if(!await askConfirm('Remove this person?','They lose access to this project straight away.','Remove'))return;
          try{ await cloud().removeMember(activeProject.id,uid); }catch(error){ await notify('That did not work','Only the owner can remove people.'); }
        };
      });
      root.querySelectorAll('[data-withdraw-invite]').forEach(function(button){
        button.onclick=async function(){
          try{ await cloud().withdrawInvite(activeProject.id,button.getAttribute('data-withdraw-invite')); }catch(error){}
        };
      });
      var exportButton=root.querySelector('[data-export-project]');
      if(exportButton)exportButton.onclick=function(){ downloadJSON(safeName(activeProject.title),projectPayload()); };
      var deleteButton=root.querySelector('[data-delete-project]');
      if(deleteButton)deleteButton.onclick=deleteActiveProject;
      var leaveButton=root.querySelector('[data-leave-project]');
      if(leaveButton)leaveButton.onclick=async function(){
        if(!await askConfirm('Leave this project?','You will not see it again unless someone invites you back.','Leave'))return;
        var leaving=activeProject.id;
        activeProject=null;blocks=[];view='project';dropWatchers();dropDatabases();render();
        try{ await cloud().removeMember(leaving,cloud().user.uid); }catch(error){}
        await loadProjects();
      };
      return;
    }
    if(loadingProject)return;
    var newSection=root.querySelector('[data-new-section]');
    if(newSection)newSection.onclick=async function(){var title=await askName('New section','e.g. Week one','Add section');if(!title||!title.trim())return;var section={id:id(),title:title.trim(),pages:[],locked:false};activeProject.sections=(activeProject.sections||[]).concat(section);activeSection=section.id;activePage='all';await cloud().saveProject(activeProject.id,{sections:activeProject.sections});render();};
    var toggle=root.querySelector('[data-toggle-view]');
    if(toggle)toggle.onclick=function(){readOnly=!readOnly;render();};
    root.querySelectorAll('[data-exit-preview]').forEach(function(button){ button.onclick=exitPreview; });
    var restore=root.querySelector('[data-restore-preview]');
    if(restore)restore.onclick=function(){ if(window.CrowStudioHistory)window.CrowStudioHistory.confirmRestore(); };
    root.querySelectorAll('[data-section]').forEach(function(button){button.onclick=function(){activeSection=button.dataset.section;activePage='all';openSectionMenu='';render();};});
    root.querySelectorAll('[data-page]').forEach(function(button){button.onclick=function(){activePage=button.dataset.page;render();};});
    root.querySelectorAll('[data-section-menu]').forEach(function(button){button.onclick=function(event){event.stopPropagation();toggleSectionMenu(button.dataset.sectionMenu);};});
    bindSectionMenu(root);
    watchSectionMenu();
    var addOpen=root.querySelector('[data-add-open]');
    if(addOpen)addOpen.onclick=function(event){ event.stopPropagation(); openAddPalette(addOpen); };
    root.querySelectorAll('[data-block]').forEach(function(card){var block=blocks.filter(function(b){return b.id===card.dataset.block;})[0], body=card.querySelector('[data-body]');card.querySelector('[data-title]').oninput=function(e){block.title=e.target.value;queuedSave(block,false,{title:block.title});};if(body)body.oninput=function(e){block.body=cleanHTML(e.target.innerHTML);queuedSave(block,false,{body:block.body});};var practice=card.querySelector('[data-practice]');if(practice)practice.oninput=function(e){block.practice=e.target.value;queuedSave(block,false,{practice:block.practice});};var answer=card.querySelector('[data-answer]');if(answer)answer.oninput=function(e){block.answer=e.target.value;queuedSave(block,false,{answer:block.answer});};var image=card.querySelector('[data-image-url]');if(image)image.onchange=function(e){block.imageUrl=e.target.value.trim();queuedSave(block,true);render();};var imageUpload=card.querySelector('[data-image-upload]');if(imageUpload)imageUpload.onchange=function(e){var file=e.target.files&&e.target.files[0];if(file)takeImage(block,file,imageUpload);e.target.value='';};
      var drop=card.querySelector('[data-image-drop]');
      if(drop)bindImageDrop(drop,block);
      var clear=card.querySelector('[data-image-clear]');
      if(clear)clear.onclick=async function(){
        var slot=block.imageSlot;
        block.imageUrl=''; block.imageSlot='';
        render();
        await cloud().patchBlock(activeProject.id,block.id,{imageUrl:'',imageSlot:''});
        if(slot)cloud().deleteProjectImage(activeProject.id,slot);
      };var status=card.querySelector('[data-status]');if(status)status.onchange=function(e){block.status=e.target.value;queuedSave(block,true);};var ideaStage=card.querySelector('[data-idea-stage]');if(ideaStage)ideaStage.onchange=function(e){block.ideaStage=e.target.value;queuedSave(block,true);};card.querySelectorAll('[data-task-check]').forEach(function(input){input.onchange=function(e){block.items[+e.target.dataset.taskCheck].done=e.target.checked;queuedSave(block,true);};});card.querySelectorAll('[data-task-text]').forEach(function(input){input.oninput=function(e){block.items[+e.target.dataset.taskText].text=e.target.value;queuedSave(block);};});var addTask=card.querySelector('[data-add-task]');if(addTask)addTask.onclick=function(){block.items.push({text:'',done:false});render();queuedSave(block,true);};var date=card.querySelector('[data-date]');if(date)date.onchange=function(e){block.due=e.target.value;queuedSave(block,true);};var remove=card.querySelector('[data-delete]');if(remove)remove.onclick=async function(){if(!await askConfirm('Delete block?', 'This block will be removed from the project.', 'Delete block'))return;var imageSlot=block.imageSlot;blocks=blocks.filter(function(b){return b.id!==block.id;});render();if(block.type==='database')await cloud().removeAllRows(activeProject.id,block.id);await cloud().deleteBlock(activeProject.id,block.id);if(imageSlot)cloud().deleteProjectImage(activeProject.id,imageSlot);};card.querySelectorAll('[data-format]').forEach(function(button){button.onmousedown=function(e){e.preventDefault();body.focus();if(button.dataset.format==='formatBlock')applyBlockTag(body,(button.dataset.value||'P').toUpperCase());else document.execCommand(button.dataset.format,false,null);tidyHeadings(body);block.body=cleanHTML(body.innerHTML);queuedSave(block);};});});
    root.querySelectorAll('[data-block]').forEach(function(card){
      var block=blocks.filter(function(b){return b.id===card.dataset.block;})[0];
      if(block&&block.type==='lesson')bindLessonCard(card,block);
    });
    root.querySelectorAll('[data-block]').forEach(function(card){
      var block=blocks.filter(function(b){return b.id===card.dataset.block;})[0];
      if(block&&block.type==='table')bindTable(card,block);
    });
    root.querySelectorAll('[data-block]').forEach(function(card){
      var block=blocks.filter(function(item){ return item.id===card.dataset.block; })[0];
      if(!block)return;
      var more=card.querySelector('[data-block-menu]');
      if(more)more.onclick=function(event){ event.stopPropagation(); openBlockMenu(card,block); };
      var icon=card.querySelector('[data-callout-icon]');
      if(icon)icon.onclick=function(event){
        event.stopPropagation();
        var showing=card.querySelector('.icon-picker');
        closeIconPicker();
        if(showing)return;
        var picker=document.createElement('div'); picker.className='icon-picker';
        picker.innerHTML=CALLOUT_ICONS.map(function(mark){ return '<button type="button" data-icon="'+mark+'">'+mark+'</button>'; }).join('');
        icon.parentNode.insertBefore(picker,icon.nextSibling);
        picker.querySelectorAll('[data-icon]').forEach(function(button){
          button.onclick=function(){
            block.icon=button.dataset.icon;
            icon.textContent=block.icon;
            closeIconPicker();
            queuedSave(block,true,{icon:block.icon});
          };
        });
        setTimeout(function(){ document.addEventListener('click',awayFromIconPicker); },0);
      };
      var code=card.querySelector('[data-code]');
      if(code)code.oninput=function(){ block.body=code.textContent; queuedSave(block,false,{body:block.body}); };
      var design=card.querySelector('[data-table-design]');
      if(design)design.onclick=function(event){ event.stopPropagation(); openTableDesign(card,block,design.parentNode); };
      bindTasks(card,block);
    });
    bindDrag();
  }
  async function deleteActiveProject(){if(!await askConfirm('Delete project?', 'This removes the project and every block inside it. This cannot be undone.', 'Delete project'))return;var removed=activeProject.id;activeProject=null;blocks=[];view='project';render();try{await cloud().deleteProject(removed);await loadProjects();}catch(error){studioError='The project could not be deleted. Try again.';render();}}
  /* Blocks reorder by dragging the grip. The card leaves the layout and
     follows the pointer, and a gap of the same size takes its place in the
     grid. That gap is what moves between slots. Keeping the held card out of
     the flow is what makes this steady: when the gap and a neighbour trade
     places, the neighbour lands where the gap was, so the pointer is no longer
     past it and it will not immediately trade back. */
  function bindDrag(){
    var grid=root.querySelector('.block-grid');
    if(!grid||grid.dataset.dragBound)return;
    grid.dataset.dragBound='1';
    var lifted=null, gap=null, armed=null, pointer=null;
    var startX=0, startY=0, grabX=0, grabY=0, lastX=0, lastY=0;

    function cards(){
      return Array.prototype.filter.call(grid.children,function(node){
        return node!==lifted&&node!==gap&&node.hasAttribute('data-block');
      });
    }
    /* First card, in reading order, that the pointer has not gone past. Cards
       in a row are rarely the same height, so the row has to be settled against
       the whole row's extent before the column is read off. Testing each card
       against its own bottom made a diagonal move skip past the shorter card in
       a row and land a slot out. */
    /* Where a card sits once everything settles. While cards slide to a new
       slot they carry a transform, and getBoundingClientRect reports where they
       are part-way there. Reading that mid-slide put the gap in the wrong slot,
       which showed up most on a diagonal drag because it re-slots often enough
       that a slide is nearly always in flight. Offsets ignore transforms. */
    function restingBox(node){
      var frame=grid.getBoundingClientRect();
      return {
        left:frame.left+(node.offsetLeft-grid.offsetLeft),
        top:frame.top+(node.offsetTop-grid.offsetTop),
        width:node.offsetWidth,
        height:node.offsetHeight,
        get right(){ return this.left+this.width; },
        get bottom(){ return this.top+this.height; }
      };
    }
    function rows(){
      var out=[], row=null;
      cards().forEach(function(node){
        var box=restingBox(node);
        if(!row||box.top>row.top+4){ row={top:box.top,bottom:box.bottom,items:[]}; out.push(row); }
        row.bottom=Math.max(row.bottom,box.bottom);
        row.items.push({node:node,box:box});
      });
      return out;
    }
    function reference(x, y){
      var list=rows();
      for(var r=0;r<list.length;r++){
        var row=list[r];
        if(y>row.bottom)continue;
        if(y<row.top)return row.items[0].node;
        for(var i=0;i<row.items.length;i++){
          var item=row.items[i];
          if(x<item.box.left+item.box.width/2)return item.node;
        }
        return list[r+1]?list[r+1].items[0].node:null;
      }
      return null;
    }
    function glide(mutate){
      var moving=cards(), was=moving.map(function(node){ return node.getBoundingClientRect(); });
      mutate();
      var shifted=[];
      moving.forEach(function(node,index){
        var now=node.getBoundingClientRect();
        var dx=was[index].left-now.left, dy=was[index].top-now.top;
        if(!dx&&!dy)return;
        node.style.transition='none';
        node.style.transform='translate('+dx+'px,'+dy+'px)';
        shifted.push(node);
      });
      if(!shifted.length)return;
      void grid.offsetWidth;
      shifted.forEach(function(node){ node.style.transition='transform .15s ease'; node.style.transform=''; });
    }
    /* A full-width card's gap takes a whole row, so re-slotting it reflows the
       rows around a pointer that has not moved, and the reading can flip back
       and forth. The gap therefore has to earn each move: some travel since the
       last one, and twice that to go straight back where it came from. The card
       itself is glued to the pointer regardless, so this stays light. */
    var HOLD=8, anchorX=0, anchorY=0, cameFrom=null, hasMoved=false;
    function place(x, y, exact){
      var mark=reference(x,y);
      if(mark===gap.nextElementSibling)return;
      if(hasMoved&&!exact){
        var travel=Math.abs(x-anchorX)+Math.abs(y-anchorY);
        if(travel<HOLD)return;
        if(mark===cameFrom&&travel<HOLD*2)return;
      }
      cameFrom=gap.nextElementSibling;
      glide(function(){ grid.insertBefore(gap,mark); });
      anchorX=x; anchorY=y; hasMoved=true;
    }
    function follow(x, y){
      lifted.style.left=(x-grabX)+'px';
      lifted.style.top=(y-grabY)+'px';
    }
    function lift(card, x, y){
      var box=card.getBoundingClientRect();
      grabX=x-box.left; grabY=y-box.top;
      gap=document.createElement('div');
      /* The gap carries the card's own classes so it takes the same slot: a
         note or a lesson spans the full row, everything else takes a half. */
      gap.className='block-gap '+card.className;
      gap.classList.remove('is-pending','save-failed');
      gap.style.height=box.height+'px';
      grid.insertBefore(gap,card);
      lifted=card;
      lifted.classList.add('is-floating');
      lifted.style.width=box.width+'px';
      lifted.style.height=box.height+'px';
      lifted.style.left=box.left+'px';
      lifted.style.top=box.top+'px';
      /* The shell above this card carries a filling transform animation, which
         makes it the containing block for anything fixed inside it. Hanging the
         card off the body instead keeps its coordinates the viewport's, so it
         sits exactly under the pointer. */
      document.body.appendChild(lifted);
      floatingCard=lifted;
      grid.classList.add('is-reordering');
      /* Entry animations stay parked for good; switching them back on would
         count as a fresh animation and flash the grid on drop. */
      cards().forEach(function(node){ node.classList.add('no-entry'); });
      lifted.classList.add('no-entry');
      cameFrom=null; hasMoved=false; anchorX=x; anchorY=y;
    }
    function drop(){
      /* Settle from wherever the card is floating into its slot. */
      var from=lifted.getBoundingClientRect();
      grid.insertBefore(lifted,gap);
      gap.parentNode.removeChild(gap);
      gap=null;
      lifted.classList.remove('is-floating');
      lifted.style.width=''; lifted.style.height=''; lifted.style.left=''; lifted.style.top='';
      var to=lifted.getBoundingClientRect();
      var dx=from.left-to.left, dy=from.top-to.top;
      var landed=lifted;
      if(dx||dy){
        landed.style.transition='none';
        landed.style.transform='translate('+dx+'px,'+dy+'px)';
        void grid.offsetWidth;
        landed.style.transition='transform .16s ease';
        landed.style.transform='';
      }
      grid.classList.remove('is-reordering');
      lifted=null; floatingCard=null;
      setTimeout(function(){ landed.style.transition=''; landed.style.transform=''; },220);
    }
    function commit(){
      var order=Array.prototype.filter.call(grid.children,function(node){ return node.hasAttribute('data-block'); })
        .map(function(node){ return node.dataset.block; });
      var was=blocks.filter(function(block){ return order.indexOf(block.id)>=0; })
        .sort(function(a,b){ return (a.order||0)-(b.order||0); })
        .map(function(block){ return block.id; });
      if(previewing())return;
      if(was.join('\u0000')===order.join('\u0000'))return;
      var stamp=Date.now(), moved=[];
      order.forEach(function(id,index){
        var block=blocks.filter(function(b){ return b.id===id; })[0];
        if(!block)return;
        block.order=stamp+index;
        moved.push(block);
      });
      /* Keep the list in the order the grid now shows, so the next render
         agrees with what was just dropped instead of springing back. */
      blocks.sort(function(a,b){ return (a.order||0)-(b.order||0); });
      /* Settle here before a single write goes out. Each one comes back as a
         snapshot, and a drop rewrites every block in the grid, so leaving this
         until afterwards let the drop echo back as a burst of redraws. */
      markShown();
      moved.forEach(function(block){
        cloud().saveBlock(activeProject.id,block.id,block).catch(function(){});
      });
    }
    function onMove(event){
      if(!armed||(pointer!==null&&event.pointerId!==pointer))return;
      /* A release can go missing over browser chrome or another window. The
         next move then arrives with no button held, which ends the drag. */
      if(event.buttons===0){ release(event); return; }
      if(!lifted){
        /* A little slack, so a click on the grip is not a drag. */
        if(Math.abs(event.clientX-startX)<4&&Math.abs(event.clientY-startY)<4)return;
        lift(armed,startX,startY);
      }
      event.preventDefault();
      lastX=event.clientX; lastY=event.clientY;
      var edge=72;
      if(event.clientY<edge)window.scrollBy(0,-14);
      else if(event.clientY>window.innerHeight-edge)window.scrollBy(0,14);
      follow(event.clientX,event.clientY);
      place(event.clientX,event.clientY);
    }
    function release(event){
      if(pointer!==null&&event&&event.pointerId!==undefined&&event.pointerId!==pointer)return;
      window.removeEventListener('pointermove',onMove,true);
      window.removeEventListener('pointerup',release,true);
      window.removeEventListener('pointercancel',release,true);
      armed=null; pointer=null;
      if(!lifted)return;
      if(event&&event.clientX!==undefined){ lastX=event.clientX; lastY=event.clientY; }
      place(lastX,lastY,true);
      drop();
      commit();
    }
    grid.addEventListener('pointerdown',function(event){
      if(event.button!==0)return;
      var handle=event.target.closest('[data-drag]');
      if(!handle||handle.disabled||!grid.contains(handle))return;
      var card=handle.closest('[data-block]');
      if(!card)return;
      event.preventDefault();
      armed=card; pointer=event.pointerId;
      startX=event.clientX; startY=event.clientY; lastX=startX; lastY=startY;
      window.addEventListener('pointermove',onMove,true);
      window.addEventListener('pointerup',release,true);
      window.addEventListener('pointercancel',release,true);
    });
  }

  var projectTimer;
  function queuedProjectSave(){if(previewing())return;clearTimeout(projectTimer);projectTimer=setTimeout(function(){cloud().saveProject(activeProject.id,{title:activeProject.title,sections:activeProject.sections||[]}).catch(function(){});},600);}
  function studioLoadError(error){
    var code=error&&error.code;
    if(code==='permission-denied')return 'Firebase turned this request down. The Firestore rules in your console need to match the ones in firestore.rules, and reading a project has to be decided by memberIds and invitedEmails, because that is what Studio looks projects up by.';
    if(code==='not-found'||code==='failed-precondition')return 'Cloud Firestore is not ready for this project. Create the Firestore database in Firebase Console, then reload this page.';
    if(code==='unavailable')return 'The browser could not reach Cloud Firestore. Check your connection or a privacy extension, then try again.';
    return 'The workspace could not be loaded.'+(code?' Firebase reported: '+code+'.':error&&error.message?' Firebase reported: '+String(error.message).replace(/^FirebaseError:\s*/,''):' Check your connection and try again.');
  }
  async function loadProjects(selectId){try{
    if(!migrated){ migrated=true; try{ await cloud().migrateOwnProjects(); }catch(error){ console.warn('Studio: older projects could not be moved across', error); } }
    await acceptPendingInvites();
    window.__crowProjects=await cloud().listProjects();
    /* A workspace with nothing in it starts with the example project. Delete it
       and it stays deleted. */
    if(!window.__crowProjects.length&&!selectId&&!exampleAlreadyOffered()){ rememberExample(); await addExampleProject(); return; }var chosen=selectId||(activeProject&&activeProject.id);activeProject=window.__crowProjects.filter(function(p){return p.id===chosen;})[0]||window.__crowProjects[0]||null;blocks=[];
    /* The opening block snapshot is real project data, even when this account
       made the most recent edit. Flag it as an initial load so echo suppression
       cannot discard it before the first render. */
    loadingProject=!!activeProject;
    studioError='';render();
    watchActiveProject();
    if(stopProjects)stopProjects();
    stopProjects=cloud().watchProjects(function(list){
      window.__crowProjects=list;
      var still=activeProject?list.filter(function(p){return p.id===activeProject.id;})[0]:null;
      var gone=activeProject&&!still;
      if(gone){ activeProject=null;blocks=[];dropWatchers(); }
      var mark=listSignature(list);
      if(mark===shownList&&!gone)return;
      if(editingNow()||floatingCard){ pendingRemote=true; pendingProjectRender=true; return; }
      shownList=mark;
      render();
    },function(){});
  }catch(error){console.warn('Studio: the project list could not be read', error);studioError=studioLoadError(error);render();}}
  /* Anything left for this address is taken up on the way in. */
  async function acceptPendingInvites(){
    if(!cloud().listInvites)return;
    try{
      var waiting=await cloud().listInvites();
      for(var i=0;i<waiting.length;i++){
        var seat=(waiting[i].invites||{})[String(cloud().user.email||'').toLowerCase().replace(/\./g,'%2E')]||'editor';
        await cloud().acceptInvite(waiting[i].id,seat);
      }
    }catch(error){ console.warn('Studio: an invitation could not be taken up', error); }
  }
  /* Held-back changes land the moment nothing here has focus. */
  document.addEventListener('focusout',function(){
    setTimeout(function(){
      if(!pendingRemote||editingNow()||floatingCard)return;
      pendingRemote=false;
      var before=pendingBlocksBefore;
      pendingBlocksBefore=null;
      if(pendingProjectRender){ pendingProjectRender=false; markShown(); render(); return; }
      markShown();
      if(before&&!patchLiveBlocks(before,blocks))render();
    },80);
  },true);
  function dropWatchers(){
    if(stopBlocks){ stopBlocks(); stopBlocks=null; }
    if(stopProject){ stopProject(); stopProject=null; }
    if(stopPresence){ stopPresence(); stopPresence=null; }
    livePeople=[];
  }
  /* Everyone in a project is on the same live copy. Remote changes arrive as
     snapshots and are folded in; a change to a block someone here is typing in
     waits until they move on. */
  function watchActiveProject(){
    dropWatchers();
    if(!activeProject||previewing())return;
    var projectId=activeProject.id;
    stopProject=cloud().watchProject(projectId,function(fresh){
      if(!fresh){
        if(activeProject&&activeProject.id===projectId){
          activeProject=null;blocks=[];dropWatchers();
          studioError='';loadProjects();
        }
        return;
      }
      if(!activeProject||activeProject.id!==projectId)return;
      var mark=projectSignature(fresh);
      activeProject=fresh;
      if(mark===shownProject)return;
      if(editingNow()||floatingCard){ pendingRemote=true; pendingProjectRender=true; return; }
      shownProject=mark;
      render();
    },function(){ studioError='This project is no longer shared with you.'; render(); });
    if(cloud().watchPresence)stopPresence=cloud().watchPresence(projectId,function(list){
      var now=Date.now(), mine=cloud().user&&cloud().user.uid;
      livePeople=list.filter(function(person){ return person.id!==mine && now-(person.updatedMs||0)<10000; });
      paintPresence();
    },presenceFailed);
    presenceWarningShown=false;
    sendPresence(true);
    stopBlocks=cloud().watchBlocks(projectId,function(list,ours){
      if(!activeProject||activeProject.id!==projectId)return;
      var before=blocks;
      var next=adoptBlocks(list.map(normalizeBlock));
      var mark=blocksSignature(next);
      var localEcho=ownBlockEcho(before,next,ours);
      blocks=next;
      var wasLoading=loadingProject;
      loadingProject=false;
      /* An empty project has the same block signature as the placeholder
         frame. Its first snapshot must still redraw, otherwise the skeleton
         remains forever after switching projects. */
      if(mark===shownBlocks){ if(wasLoading)render(); return; }
      if(localEcho){
        shownBlocks=mark;
        return;
      }
      /* A drag is structural. Ordinary remote updates patch immediately,
         including other cards while this person is typing in one of them. */
      if(floatingCard){
        if(!pendingBlocksBefore)pendingBlocksBefore=before;
        pendingRemote=true;
        return;
      }
      shownBlocks=mark;
      if(!patchLiveBlocks(before,next)){
        if(editingNow()){
          if(!pendingBlocksBefore)pendingBlocksBefore=before;
          pendingRemote=true;
          return;
        }
        render();
      }
    },function(){ studioError='The project could not be loaded. Check your connection and try again.'; render(); });
  }
  /* Switching projects shows the new project's frame straight away with
     placeholder cards, then the live blocks arrive. */
  async function loadProject(projectId){
    try{
      activeProject=(window.__crowProjects||[]).filter(function(p){return p.id===projectId;})[0]||null;
      activeSection='all';activePage='all';blocks=[];studioError='';
      loadingProject=!!activeProject;
      render();
      watchActiveProject();
    }catch(error){
      loadingProject=false;
      studioError='The project could not be loaded. Check your connection and try again.';
      render();
    }
  }
  window.addEventListener('crow-auth-state',function(event){if(event.detail&&event.detail.user)loadProjects();else{window.__crowProjects=[];activeProject=null;blocks=[];studioError='';render();}});
  window.addEventListener('crow-collab-ready',function(){ mountCollaborativeEditors(); });
  function boot(){
    if(!cloud()){setTimeout(boot,20);return;}
    render();
    if(cloud().user)loadProjects();
    /* A Firebase auth callback should arrive immediately for a signed-out
       visitor. If the network or a cached SDK fails to deliver it, never
       leave the person staring at an endless loading screen. A later real
       callback still replaces this fallback with the correct signed-in view. */
    if(cloud().initializing) setTimeout(function(){
      if(cloud().initializing){ cloud().initializing=false; render(); }
    },1600);
  }
  /* What the history panel needs from the running workspace, and nothing
     else: which project is open, what it says right now, and the two ways of
     standing somewhere other than the present. */
  window.CrowStudio={
    projectId:function(){ return activeProject?activeProject.id:''; },
    canEdit:function(){ return !!activeProject&&canEdit(); },
    /* Always the live project, even while an old version is on screen, so
       history never records what somebody was merely looking at. */
    snapshot:function(){
      var from=preview?liveState:{ project:activeProject, blocks:blocks };
      if(!from||!from.project)return null;
      var rows={};
      /* A database's rows are not inside its block, so a version that saved
         only blocks would restore an empty database and read as data loss. */
      (from.blocks||[]).filter(isDatabase).forEach(function(block){
        rows[block.id]=dbRowsOf(block.id).map(function(row){ return Object.assign({},row); });
      });
      return { project:{ title:from.project.title, sections:from.project.sections||[] },
        blocks:(from.blocks||[]).map(function(block){ var copy=Object.assign({},block); delete copy.pending; return copy; }),
        rows:rows };
    },
    previewing:function(){ return previewing(); },
    previewEntry:function(){ return preview; },
    openPreview:enterPreview,
    closePreview:exitPreview,
    restore:restoreSnapshot,
    reload:function(id){ return loadProjects(id||(activeProject&&activeProject.id)); }
  };
  boot();
}());
