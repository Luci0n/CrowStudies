/* CrowStudies shared whiteboard. Loaded only when a WSS endpoint is configured.

   A whiteboard is Excalidraw drawing into a Yjs map of its elements by id, kept
   by the same collaboration server as shared notes. Each element carries a
   version, and Excalidraw's own reconcileElements decides between two copies
   of one element, so two people drawing at once both keep their strokes; a
   deletion is an element marked deleted, so it merges like any other change.

   The imports below are the same URLs collab-editor.js uses, so the page holds
   one Yjs. React and Excalidraw are large (several seconds on a cold load), so
   they are fetched only when a whiteboard is first drawn on the page. */
import * as Y from 'https://esm.sh/yjs@13.6.33';
import { HocuspocusProvider } from 'https://esm.sh/@hocuspocus/provider@3.2.3?deps=yjs@13.6.33,@hocuspocus/common@3.2.3';

const config = window.CrowStudiesCollabConfig || {};
const EXCALIDRAW = '@excalidraw/excalidraw@0.18.1';
const REACT = 'react@18.3.1', REACT_DOM = 'react-dom@18.3.1';
const LOCAL = 'crowstudies-local';
const SYNC_WAIT_MS = 12000, MIRROR_QUIET_MS = 1500, PARK_LIMIT = 60000;
const colors = ['#8466ff','#ed5d9a','#35c9db','#e0a42d','#45c77e','#ee7a59'];
const live = new Map(), pending = new Map(), statics = new Set();
function colorFor(id){ let n=0; for(const char of String(id||'')) n=(n*31+char.charCodeAt(0))>>>0; return colors[n%colors.length]; }

let library = null;
function loadLibrary(){
  if(library) return library;
  window.EXCALIDRAW_ASSET_PATH = 'https://esm.sh/'+EXCALIDRAW+'/dist/prod/';
  if(!document.querySelector('link[data-excalidraw-css]')){
    const css=document.createElement('link');
    css.rel='stylesheet'; css.href='https://esm.sh/'+EXCALIDRAW+'/dist/prod/index.css'; css.dataset.excalidrawCss='';
    document.head.appendChild(css);
  }
  library = Promise.all([
    import('https://esm.sh/'+REACT),
    import('https://esm.sh/'+REACT_DOM+'/client?deps='+REACT),
    import('https://esm.sh/'+EXCALIDRAW+'?deps='+REACT+','+REACT_DOM),
  ]).then(([React, ReactDOM, Excalidraw])=>({ React, ReactDOM, Ex:Excalidraw }));
  library.catch(()=>{ library=null; });
  return library;
}

function themeNow(){ return /-light$/.test(document.documentElement.getAttribute('data-theme')||'') ? 'light' : 'dark'; }
function parseBoard(json){
  try{ const list=JSON.parse(json||'[]'); return Array.isArray(list)?list:[]; }catch(error){ return []; }
}
function plain(element){ return JSON.parse(JSON.stringify(element)); }

function whenSynced(provider){
  return new Promise((resolve,reject)=>{
    if(provider.isSynced){ resolve(); return; }
    const timer=setTimeout(()=>{ provider.off('synced',done); reject(new Error('The collaboration server did not answer.')); },SYNC_WAIT_MS);
    function done(event){ if(event&&event.state===false)return; clearTimeout(timer); provider.off('synced',done); resolve(); }
    provider.on('synced',done);
  });
}
function whenSent(provider){
  return new Promise((resolve,reject)=>{
    if(!provider.hasUnsyncedChanges){ resolve(); return; }
    const timer=setTimeout(()=>{ provider.off('unsyncedChanges',check); reject(new Error('The collaboration server did not take the change.')); },SYNC_WAIT_MS);
    function check(){ if(provider.hasUnsyncedChanges)return; clearTimeout(timer); provider.off('unsyncedChanges',check); resolve(); }
    provider.on('unsyncedChanges',check);
  });
}

/* Excalidraw is drawn again whenever what it is told changes: whether it may
   be edited, the theme, the people pointing at it. */
const UI_OPTIONS = {
  canvasActions:{ loadScene:false, saveToActiveFile:false, toggleTheme:null, export:false, saveAsImage:true, clearCanvas:true, changeViewBackgroundColor:true },
  tools:{ image:false },
};
function draw(entry){
  const { React, Ex } = entry.lib;
  entry.root.render(React.createElement(Ex.Excalidraw, {
    excalidrawAPI:(api)=>{ if(api&&!entry.api){ entry.api=api; entry.apiReady(); } },
    initialData:{ elements:entry.initial, appState:{ viewBackgroundColor:'transparent' }, scrollToContent:true },
    viewModeEnabled:!entry.open,
    theme:themeNow(),
    isCollaborating:!!entry.provider,
    UIOptions:UI_OPTIONS,
    onChange:()=>schedulePush(entry),
    onPointerUpdate:(update)=>sharePointer(entry,update),
    onPaste:(data, event)=>!refusesImages(entry,data,event),
  }));
}
/* Pictures would fill a shared document's room quickly, so a whiteboard does
   not take them yet; it says so rather than letting one vanish later. */
function refusesImages(entry, data, event){
  const files=data&&data.files&&Object.keys(data.files).length;
  let pictures=false;
  try{ pictures=Array.from((event&&event.clipboardData&&event.clipboardData.items)||[]).some((item)=>/^image\//.test(item.type)); }catch(error){}
  if(files||pictures){ notice(entry); return true; }
  return false;
}
function notice(entry){ if(entry.options&&entry.options.onNotice) entry.options.onNotice('Pictures cannot go on a whiteboard yet.'); }

/* Batched on a short timer rather than an animation frame: a browser pauses
   animation frames in a tab that is out of sight, and strokes made just before
   switching away would sit unsent until the tab came back. */
function schedulePush(entry){
  if(entry.pushFrame) return;
  entry.pushFrame=setTimeout(()=>{ entry.pushFrame=0; push(entry); },16);
}
/* Send what this person changed: every element whose version is past the one
   last sent or received. */
function push(entry){
  if(!entry.api||!entry.synced||!entry.open) return;
  const { Ex } = entry.lib;
  let all=entry.api.getSceneElementsIncludingDeleted();
  if(all.some((element)=>element.type==='image'&&!element.isDeleted)){
    all=all.map((element)=>element.type==='image'&&!element.isDeleted?Ex.newElementWith(element,{ isDeleted:true }):element);
    entry.api.updateScene({ elements:all, captureUpdate:Ex.CaptureUpdateAction.NEVER });
    notice(entry);
  }
  const changed=all.filter((element)=>element.type!=='image'&&(entry.known.get(element.id)??-1)<element.version);
  if(!changed.length) return;
  entry.ydoc.transact(()=>{
    changed.forEach((element)=>{ entry.map.set(element.id,plain(element)); entry.known.set(element.id,element.version); });
  },LOCAL);
  clearTimeout(entry.mirrorTimer);
  entry.mirrorTimer=setTimeout(()=>mirror(entry),MIRROR_QUIET_MS);
}
/* The block's saved copy, which History, Duplicate and Export read. Only this
   person's own changes trigger it, so a change is not written by everyone. */
function mirror(entry){
  if(!entry.api||!entry.options.onLocalChange) return;
  entry.options.onLocalChange(JSON.stringify(entry.api.getSceneElements().map(plain)));
}
/* Someone else's elements, merged with what is on screen. The merge goes
   around the undo history, so undo only ever takes back your own strokes. */
function applyRemote(entry, remote, wholeScene){
  if(!entry.api||!remote) return;
  const { Ex } = entry.lib;
  const incoming=Ex.restoreElements(remote,null,{ refreshDimensions:false, repairBindings:true });
  const elements=wholeScene?incoming:Ex.reconcileElements(entry.api.getSceneElementsIncludingDeleted(),incoming,entry.api.getAppState());
  entry.api.updateScene({ elements, captureUpdate:Ex.CaptureUpdateAction.NEVER });
  const now=new Map(entry.api.getSceneElementsIncludingDeleted().map((element)=>[element.id,element.version]));
  incoming.forEach((element)=>{ entry.known.set(element.id,Math.max(entry.known.get(element.id)??-1,now.get(element.id)??element.version)); });
}

function sharePointer(entry, update){
  if(!entry.provider||!update||!update.pointer) return;
  const now=Date.now();
  if(now-(entry.pointerAt||0)<40) return;
  entry.pointerAt=now;
  entry.provider.awareness.setLocalStateField('pointer',{ x:update.pointer.x, y:update.pointer.y, tool:update.pointer.tool||'pointer', button:update.button||'up' });
}
function paintCollaborators(entry){
  if(!entry.api||!entry.provider) return;
  const mine=entry.provider.awareness.clientID, people=new Map();
  entry.provider.awareness.getStates().forEach((state,id)=>{
    if(id===mine||!state||!state.user) return;
    const color=state.user.color||'#8466ff';
    people.set(String(id),{ id:String(id), username:state.user.name, color:{ background:color, stroke:color },
      pointer:state.pointer?{ x:state.pointer.x, y:state.pointer.y, tool:state.pointer.tool }:undefined,
      button:state.pointer?state.pointer.button:'up' });
  });
  entry.api.updateScene({ collaborators:people });
}

function adopt(entry, host, options){
  entry.options=options; entry.parkedAt=0;
  if(entry.host!==host){
    if(!host.isConnected) return entry;
    host.replaceWith(entry.host);
  }
  const open=entry.synced&&!options.readOnly;
  if(open!==entry.open){ entry.open=open; draw(entry); }
  if(options.onStatus&&entry.status) options.onStatus(entry.status);
  return entry;
}
async function mount(host, options){
  if(!config.url) return null;
  const name=options.documentName;
  if(live.has(name)) return adopt(live.get(name),host,options);
  if(pending.has(name)){
    const entry=await pending.get(name);
    return entry?adopt(entry,host,options):null;
  }
  const starting=create(host,options);
  pending.set(name,starting);
  try{ return await starting; }
  finally{ pending.delete(name); }
}
async function create(host, options){
  host.dataset.collabActive='true';
  const lib=await loadLibrary();
  const ydoc=new Y.Doc(), map=ydoc.getMap('elements');
  const entry={ options, lib, host, ydoc, map, status:'', parkedAt:0, synced:false, open:false, api:null, known:new Map(),
    initial:parseBoard(options.saved) };
  entry.ready=new Promise((resolve)=>{ entry.apiReady=resolve; });
  /* A fresh token on every connection: one lasts an hour, and a board left
     open longer would otherwise be turned away for good. */
  const provider=new HocuspocusProvider({
    url:config.url, name:options.documentName, document:ydoc, preserveConnection:false,
    token:()=>entry.options.user.getIdToken(),
    onStatus:({status})=>{ entry.status=status; if(entry.options.onStatus) entry.options.onStatus(status); },
  });
  entry.provider=provider;
  provider.awareness.setLocalStateField('user',{ name:'@'+options.username, color:colorFor(options.user.uid) });
  host.textContent='';
  entry.root=lib.ReactDOM.createRoot(host);
  draw(entry);
  /* The frame changes size with the height setting, full screen, and being
     handed to a new card; Excalidraw only notices the window by itself. */
  entry.resize=new ResizeObserver(()=>{ if(entry.api) entry.api.refresh(); });
  entry.resize.observe(host);
  map.observe((event, transaction)=>{
    if(transaction.origin===LOCAL||!entry.synced) return;
    applyRemote(entry,Array.from(event.keysChanged).map((id)=>map.get(id)).filter(Boolean));
  });
  provider.awareness.on('change',()=>paintCollaborators(entry));
  entry.themeWatch=new MutationObserver(()=>draw(entry));
  entry.themeWatch.observe(document.documentElement,{ attributes:true, attributeFilter:['data-theme'] });
  live.set(options.documentName,entry);
  /* Nothing can be drawn until the server's copy is in: strokes made before
     that would exist in this browser alone. */
  let heard=false;
  const caughtUp=async(event)=>{
    if(heard||(event&&event.state===false)) return;
    heard=true; provider.off('synced',caughtUp);
    await entry.ready;
    if(live.get(options.documentName)!==entry) return;
    applyRemote(entry,Array.from(map.values()),true);
    entry.synced=true;
    entry.open=!entry.options.readOnly;
    draw(entry);
    if(entry.options.onSynced) entry.options.onSynced();
  };
  if(provider.isSynced) caughtUp(); else provider.on('synced',caughtUp);
  return entry;
}
function destroy(name){
  const entry=live.get(name); if(!entry) return;
  clearTimeout(entry.mirrorTimer);
  clearTimeout(entry.pushFrame);
  entry.resize.disconnect(); entry.themeWatch.disconnect();
  try{ entry.root.unmount(); }catch(error){}
  entry.provider.destroy(); entry.ydoc.destroy();
  live.delete(name);
}
function destroyAll(){ Array.from(live.keys()).forEach(destroy); }
function keepOnly(prefix){ Array.from(live.keys()).forEach((name)=>{ if(!prefix||name.indexOf(prefix)!==0) destroy(name); }); }
setInterval(()=>{
  const now=Date.now();
  live.forEach((entry,name)=>{
    if(entry.host.isConnected){ entry.parkedAt=0; return; }
    if(!entry.parkedAt){ entry.parkedAt=now; return; }
    if(now-entry.parkedAt>PARK_LIMIT) destroy(name);
  });
  statics.forEach((item)=>{ if(!item.host.isConnected){ try{ item.root.unmount(); }catch(error){} statics.delete(item); } });
},15000);

/* A board to look at, drawn from a saved copy with no connection: an old
   version in History, or Studio without a collaboration server. */
async function mountStatic(host, json){
  const lib=await loadLibrary();
  if(!host.isConnected) return null;
  host.textContent='';
  const root=lib.ReactDOM.createRoot(host);
  root.render(lib.React.createElement(lib.Ex.Excalidraw,{
    initialData:{ elements:parseBoard(json), appState:{ viewBackgroundColor:'transparent' }, scrollToContent:true },
    viewModeEnabled:true, theme:themeNow(), UIOptions:UI_OPTIONS,
  }));
  statics.add({ host, root });
  return true;
}

/* The drawing as it stands, if this board is open and caught up. */
function elements(name){
  const entry=live.get(name);
  return entry&&entry.synced&&entry.api?entry.api.getSceneElements().map(plain):null;
}
async function withDocument(name, options, use){
  const entry=live.get(name);
  if(entry){ await whenSynced(entry.provider); return use(entry.map,entry.ydoc,entry.provider); }
  const ydoc=new Y.Doc();
  const provider=new HocuspocusProvider({ url:config.url, name, document:ydoc, preserveConnection:false, token:()=>options.user.getIdToken() });
  try{
    await whenSynced(provider);
    return await use(ydoc.getMap('elements'),ydoc,provider);
  }finally{ provider.destroy(); ydoc.destroy(); }
}
/* What a board's shared document holds, open on the page or not. */
async function read(name, options){
  if(!config.url) return null;
  return withDocument(name,options,async(map)=>Array.from(map.values()).filter((element)=>element&&!element.isDeleted));
}
/* Make a board's shared document hold exactly these elements: the ones given
   win over what is there, and anything else is marked deleted. Restoring a
   version comes through here. */
async function replace(name, list, options){
  if(!config.url) return false;
  const wanted=Array.isArray(list)?list:[];
  return withDocument(name,options,async(map,ydoc,provider)=>{
    const keep=new Set(wanted.map((element)=>element.id));
    ydoc.transact(()=>{
      wanted.forEach((element)=>{
        const there=map.get(element.id);
        const version=Math.max(element.version||1,there?there.version||1:1)+1;
        map.set(element.id,Object.assign(plain(element),{ version, versionNonce:Math.floor(Math.random()*2**31), updated:Date.now(), isDeleted:false }));
      });
      Array.from(map.entries()).forEach(([id,element])=>{
        if(keep.has(id)||!element||element.isDeleted) return;
        map.set(id,Object.assign(plain(element),{ isDeleted:true, version:(element.version||1)+1, versionNonce:Math.floor(Math.random()*2**31), updated:Date.now() }));
      });
    },'crowstudies-replace');
    await whenSent(provider);
    return true;
  });
}
window.CrowWhiteboard={ enabled:()=>Boolean(config.url), mount, destroy, destroyAll, keepOnly, elements, read, replace, mountStatic, loadLibrary };
window.dispatchEvent(new Event('crow-whiteboard-ready'));
