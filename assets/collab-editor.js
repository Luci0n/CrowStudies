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
  host.parentNode.insertBefore(controls,host);
  const entry={editor,provider,offline,controls,host};
  live.set(options.documentName,entry);
  return entry;
}
function destroy(documentName){
  const entry=live.get(documentName); if(!entry)return;
  entry.controls.remove(); entry.editor.destroy(); entry.provider.destroy(); entry.offline.destroy(); live.delete(documentName);
}
function destroyAll(){ Array.from(live.keys()).forEach(destroy); }
window.CrowCollab={enabled:()=>Boolean(config.url),mount,destroy,destroyAll};
window.dispatchEvent(new Event('crow-collab-ready'));
