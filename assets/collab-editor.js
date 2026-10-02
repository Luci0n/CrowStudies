/* CrowStudies rich collaborative editor. Loaded only when a WSS endpoint is configured. */
import * as Y from 'https://esm.sh/yjs@13.6.24';
import { IndexeddbPersistence } from 'https://esm.sh/y-indexeddb@9.0.12';
import { Editor } from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';
import Link from 'https://esm.sh/@tiptap/extension-link@2.11.5';
import Table from 'https://esm.sh/@tiptap/extension-table@2.11.5';
import TableRow from 'https://esm.sh/@tiptap/extension-table-row@2.11.5';
import TableHeader from 'https://esm.sh/@tiptap/extension-table-header@2.11.5';
import TableCell from 'https://esm.sh/@tiptap/extension-table-cell@2.11.5';
import { Collaboration } from 'https://esm.sh/@tiptap/extension-collaboration@2.11.5';
import { CollaborationCaret } from 'https://esm.sh/@tiptap/extension-collaboration-caret@2.11.5';
import { HocuspocusProvider } from 'https://esm.sh/@hocuspocus/provider@3.2.3';

const config = window.CrowStudiesCollabConfig || {};
const live = new Map();
const colors = ['#8466ff','#ed5d9a','#35c9db','#e0a42d','#45c77e','#ee7a59'];
function colorFor(id){ let n=0; for(const char of String(id||'')) n=(n*31+char.charCodeAt(0))>>>0; return colors[n%colors.length]; }
function toolbar(editor){
  const bar=document.createElement('div'); bar.className='rich-tools collab-tools';
  const actions=[
    ['B','toggleBold'],['I','toggleItalic'],['• list','toggleBulletList'],['H1','toggleHeading',{level:1}],['H2','toggleHeading',{level:2}],['H3','toggleHeading',{level:3}],['P','setParagraph']
  ];
  actions.forEach(([label,command,args])=>{ const button=document.createElement('button'); button.type='button'; button.innerHTML=label==='B'?'<b>B</b>':label==='I'?'<i>I</i>':label; button.onclick=()=>{ const chain=editor.chain().focus()[command](args); chain.run(); }; bar.append(button); });
  return bar;
}

/* An editor outlives the redraw that drew its card. Studio rebuilds the whole
   project whenever the section, page or mode changes; tearing every shared
   note down with it and connecting again made each switch flash the stored
   text, then jump when the live document replaced it. Instead an editor is
   kept, and the next card drawn for the same note takes it back: its element
   moves into the new card, still connected and showing what it showed. */
const pending = new Map();
const PARK_LIMIT = 60000;
function adopt(entry, host, options){
  entry.onStatus = options.onStatus;
  entry.parkedAt = 0;
  if(entry.host !== host){
    if(!host.isConnected) return entry;
    /* The fresh card's own attributes say how it is drawn now (editable or
       not, its placeholder); the kept element takes them over. */
    ['contenteditable','data-placeholder'].forEach((name)=>{
      if(host.hasAttribute(name)) entry.host.setAttribute(name, host.getAttribute(name));
    });
    host.replaceWith(entry.host);
  }
  if(entry.host.parentNode && entry.controls.nextSibling !== entry.host){
    entry.host.parentNode.insertBefore(entry.controls, entry.host);
  }
  /* The editor is already in its new card by now. If telling it about a
     change of mode trips over the document, keep it there rather than throw
     and have Studio fall back to the stored text beside a live editor. */
  const editable = !options.readOnly;
  try{ if(entry.editor.isEditable !== editable) entry.editor.setEditable(editable); }
  catch(error){ console.warn('Collaborative note could not change mode', error); }
  if(entry.onStatus && entry.status) entry.onStatus(entry.status);
  return entry;
}
async function mount(host, options){
  if(!config.url) return null;
  const name = options.documentName;
  if(live.has(name)) return adopt(live.get(name), host, options);
  /* A redraw can come while the editor for this note is still connecting.
     Wait for that one rather than starting a second editor beside it. */
  if(pending.has(name)){
    const entry = await pending.get(name);
    return entry ? adopt(entry, host, options) : null;
  }
  const starting = create(host, options);
  pending.set(name, starting);
  try{ return await starting; }
  finally{ pending.delete(name); }
}
async function create(host, options){
  host.dataset.collabActive='true';
  host.oninput=null; // Never leave the old HTML/Firestore writer attached.
  /* The note keeps the text it is already showing until the editor is ready to
     take over. Emptying it here collapsed every shared note to a single line
     for the length of a round trip, and the page jumped twice for it. */
  const ydoc=new Y.Doc();
  const offline=new IndexeddbPersistence('crowstudies:'+options.documentName,ydoc);
  const token=await options.user.getIdToken();
  const entry={ onStatus:options.onStatus, status:'', parkedAt:0 };
  const provider=new HocuspocusProvider({
    url:config.url,
    name:options.documentName,
    document:ydoc,
    token,
    preserveConnection:false,
    onStatus:({status})=>{ entry.status=status; if(entry.onStatus) entry.onStatus(status); },
  });
  const user={name:'@'+options.username,color:colorFor(options.user.uid),avatar:options.avatarUrl||undefined};
  host.textContent='';
  const editor=new Editor({
    element:host,
    editable:!options.readOnly,
    extensions:[
      StarterKit.configure({history:false}),
      Link.configure({openOnClick:false}),
      Table.configure({resizable:true}),TableRow,TableHeader,TableCell,
      Collaboration.configure({document:ydoc}),
      CollaborationCaret.configure({provider,user}),
    ],
    editorProps:{attributes:{class:'tiptap ProseMirror','aria-label':'Collaborative note'}},
  });
  const controls=toolbar(editor);
  Object.assign(entry,{editor,provider,offline,controls,host});
  if(host.parentNode) host.parentNode.insertBefore(controls,host);
  live.set(options.documentName,entry);
  return entry;
}
function destroy(documentName){
  const entry=live.get(documentName); if(!entry)return;
  entry.controls.remove(); entry.editor.destroy(); entry.provider.destroy(); entry.offline.destroy(); live.delete(documentName);
}
function destroyAll(){ Array.from(live.keys()).forEach(destroy); }
/* Keep the editors whose name starts with prefix, close the rest. Studio calls
   this before each redraw with the open project's prefix, or with nothing
   when no live notes should stay open (another project, an old version). */
function keepOnly(prefix){
  Array.from(live.keys()).forEach((name)=>{ if(!prefix || name.indexOf(prefix)!==0) destroy(name); });
}
/* A kept editor whose note is not on screen (another section, a deleted
   block) still holds a connection. Close it once it has been away a minute;
   coming back after that simply connects again. */
setInterval(()=>{
  const now=Date.now();
  live.forEach((entry,name)=>{
    if(entry.host.isConnected){ entry.parkedAt=0; return; }
    if(!entry.parkedAt){ entry.parkedAt=now; return; }
    if(now-entry.parkedAt>PARK_LIMIT) destroy(name);
  });
},15000);
window.CrowCollab={enabled:()=>Boolean(config.url),mount,destroy,destroyAll,keepOnly};
window.dispatchEvent(new Event('crow-collab-ready'));
