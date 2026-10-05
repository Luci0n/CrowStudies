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
const SYNC_WAIT_MS = 12000;
function colorFor(id){ let n=0; for(const char of String(id||'')) n=(n*31+char.charCodeAt(0))>>>0; return colors[n%colors.length]; }
/* The schema must match the server's exactly, or content it does not know is
   dropped on the way in. */
function schema(ydoc){
  return [
    StarterKit.configure({history:false}),
    Link.configure({openOnClick:false}),
    Table.configure({resizable:true}),TableRow,TableHeader,TableCell,
    Collaboration.configure({document:ydoc}),
  ];
}
/* Every transaction y-prosemirror makes itself, whether drawing the document
   when it opens or applying someone else's change, carries this meta key.
   Anything without it was typed here. */
function typedHere(transaction){
  if(!transaction.docChanged)return false;
  /* The key is "y-sync$", or "y-sync$1" and on if the module was loaded twice. */
  return !Object.keys(transaction.meta||{}).some((key)=>key.indexOf('y-sync$')===0);
}
/* y-prosemirror draws the shared document into a new editor on a timer of its
   own, so until that has run the editor reports an empty note. */
function firstDrawn(){ return new Promise((resolve)=>setTimeout(resolve,30)); }
function whenSynced(provider){
  return new Promise((resolve,reject)=>{
    if(provider.isSynced){ resolve(); return; }
    const timer=setTimeout(()=>{ provider.off('synced',done); reject(new Error('The collaboration server did not answer.')); },SYNC_WAIT_MS);
    function done(event){ if(event&&event.state===false)return; clearTimeout(timer); provider.off('synced',done); resolve(); }
    provider.on('synced',done);
  });
}
/* Changes are sent as they happen; this waits until the server has them all,
   so a caller can close the connection without losing the last of them. */
function whenSent(provider){
  return new Promise((resolve,reject)=>{
    if(!provider.hasUnsyncedChanges){ resolve(); return; }
    const timer=setTimeout(()=>{ provider.off('unsyncedChanges',check); reject(new Error('The collaboration server did not take the change.')); },SYNC_WAIT_MS);
    function check(){ if(provider.hasUnsyncedChanges)return; clearTimeout(timer); provider.off('unsyncedChanges',check); resolve(); }
    provider.on('unsyncedChanges',check);
  });
}
function toolbar(editor){
  const bar=document.createElement('div'); bar.className='rich-tools collab-tools';
  const actions=[
    ['B','toggleBold'],['I','toggleItalic'],['• list','toggleBulletList'],['H1','toggleHeading',{level:1}],['H2','toggleHeading',{level:2}],['H3','toggleHeading',{level:3}],['P','setParagraph']
  ];
  actions.forEach(([label,command,args])=>{ const button=document.createElement('button'); button.type='button'; button.innerHTML=label==='B'?'<b>B</b>':label==='I'?'<i>I</i>':label; button.onclick=()=>{ const chain=editor.chain().focus()[command](args); chain.run(); }; bar.append(button); });
  return bar;
}

async function mount(host, options){
  if(!config.url || live.has(options.documentName)) return null;
  host.dataset.collabActive='true';
  host.oninput=null; // Never leave the old HTML/Firestore writer attached.
  /* The note keeps the text it is already showing until the editor is ready to
     take over. Emptying it here collapsed every shared note to a single line
     for the length of a round trip, and the page jumped twice for it. */
  const ydoc=new Y.Doc();
  const offline=new IndexeddbPersistence('crowstudies:'+options.documentName,ydoc);
  const token=await options.user.getIdToken();
  const provider=new HocuspocusProvider({
    url:config.url,
    name:options.documentName,
    document:ydoc,
    token,
    preserveConnection:false,
    onStatus:({status})=>options.onStatus&&options.onStatus(status),
  });
  const user={name:'@'+options.username,color:colorFor(options.user.uid),avatar:options.avatarUrl||undefined};
  host.textContent='';
  const editor=new Editor({
    element:host,
    editable:!options.readOnly,
    extensions:schema(ydoc).concat(CollaborationCaret.configure({provider,user})),
    editorProps:{attributes:{class:'tiptap ProseMirror','aria-label':'Collaborative note'}},
  });
  const controls=toolbar(editor);
  host.parentNode.insertBefore(controls,host);
  const entry={editor,provider,offline,controls,host,synced:false};
  /* The block's `body` is the copy everything outside this editor reads:
     history, duplicate, turn into, export and the contents block. Only edits
     made here are reported, so one change is not written back by everyone
     who received it, and only once the server's copy has arrived: before that
     the editor holds part of the note at most, and writing that over `body`
     would throw away the one copy that may still be whole. */
  editor.on('update',({transaction})=>{
    if(options.onLocalChange&&entry.synced&&typedHere(transaction))options.onLocalChange(editor.getHTML());
  });
  /* A note that connects late still has to count as caught up when it does,
     so this listens for as long as the editor is open. */
  const caughtUp=(event)=>{
    if(entry.synced||(event&&event.state===false))return;
    provider.off('synced',caughtUp);
    firstDrawn().then(()=>{ entry.synced=true; if(options.onSynced)options.onSynced(); });
  };
  if(provider.isSynced)caughtUp(); else provider.on('synced',caughtUp);
  live.set(options.documentName,entry);
  return entry;
}
function destroy(documentName){
  const entry=live.get(documentName); if(!entry)return;
  entry.controls.remove(); entry.editor.destroy(); entry.provider.destroy(); entry.offline.destroy(); live.delete(documentName);
}
function destroyAll(){ Array.from(live.keys()).forEach(destroy); }
/* What a note says right now, if it is open and has caught up with the
   server. Before that the editor may be showing nothing at all, and an empty
   answer would be mistaken for an empty note. */
function html(documentName){
  const entry=live.get(documentName);
  return entry&&entry.synced?entry.editor.getHTML():null;
}
/* Put text into a note's shared document, so everyone sees it and the server
   keeps it. Restoring a version and turning a block back into a note both
   need this: writing `body` alone never reaches a note that is shared. */
async function replace(documentName, content, options){
  if(!config.url)return false;
  return withDocument(documentName, options, async (editor, provider)=>{
    if(editor.getHTML()===content)return true;
    editor.commands.setContent(content||'<p></p>',true);
    await whenSent(provider);
    return true;
  });
}
/* What a note's shared document says, whether or not it is open on the page:
   a note in another section has no editor here, and its `body` may be old. */
async function read(documentName, options){
  if(!config.url)return null;
  return withDocument(documentName, options, async (editor)=>editor.getHTML());
}
/* The open editor when there is one, otherwise a short-lived connection with
   no element on the page and nothing kept in this browser. */
async function withDocument(documentName, options, use){
  const entry=live.get(documentName);
  if(entry){
    await whenSynced(entry.provider);
    await firstDrawn();
    entry.synced=true;
    return use(entry.editor, entry.provider);
  }
  const ydoc=new Y.Doc();
  const token=await options.user.getIdToken();
  const provider=new HocuspocusProvider({ url:config.url, name:documentName, document:ydoc, token, preserveConnection:false });
  let editor=null;
  try{
    await whenSynced(provider);
    editor=new Editor({ element:document.createElement('div'), extensions:schema(ydoc) });
    await firstDrawn();
    return await use(editor, provider);
  }finally{
    if(editor)editor.destroy();
    provider.destroy();
    ydoc.destroy();
  }
}
window.CrowCollab={enabled:()=>Boolean(config.url),mount,destroy,destroyAll,html,replace,read};
window.dispatchEvent(new Event('crow-collab-ready'));
