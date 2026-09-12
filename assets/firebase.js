import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, query, orderBy, where, onSnapshot, arrayUnion, arrayRemove, writeBatch, increment } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBKaA8fPVgQQdcAFTcHB7_byGcnQahcd2Y',
  authDomain: 'crowstudies-8696e.firebaseapp.com',
  projectId: 'crowstudies-8696e',
  storageBucket: 'crowstudies-8696e.firebasestorage.app',
  messagingSenderId: '481140454513',
  appId: '1:481140454513:web:861d0c783785115c8417d0'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function initials(user){
  return String(user.displayName || user.email || '?').trim().split(/\s+/).slice(0,2).map(function(part){ return part.charAt(0); }).join('').toUpperCase();
}
function closeAccountMenu(){
  var menu=document.querySelector('.account-popover');
  if (menu) menu.remove();
}
const THEME_KEY='crowstudies:theme';
const THEME_OPTIONS=[
  {id:'system',name:'System',note:'Follow your device'},
  {id:'gruvbox-light',name:'Gruvbox · Light',note:'Warm paper and retro ink'},
  {id:'gruvbox-dark',name:'Gruvbox · Dark',note:'Earthy amber after dark'},
  {id:'monokai-light',name:'Monokai Machine · Light',note:'Clean metal with neon syntax'},
  {id:'monokai-dark',name:'Monokai Machine · Dark',note:'Charcoal, lime, and hot pink'},
  {id:'runner-light',name:'City Runner · Light',note:'White rooftops and red routes'},
  {id:'runner-dark',name:'City Runner · Dark',note:'Night glass with signal red'}
];
function currentTheme(){
  try{return localStorage.getItem(THEME_KEY)||'system';}catch(error){return 'system';}
}
function applyTheme(theme){
  var choice=THEME_OPTIONS.some(function(option){return option.id===theme;})?theme:'system';
  if(choice==='system')document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',choice);
  try{localStorage.setItem(THEME_KEY,choice);}catch(error){}
}
function openThemePicker(){
  var shade=document.createElement('div'), dialog=document.createElement('section');
  shade.className='app-overlay'; dialog.className='app-dialog theme-dialog';
  dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
  var title=document.createElement('h2'); title.textContent='Choose a theme';
  var intro=document.createElement('p'); intro.textContent='Themes apply across CrowStudies and stay on this device.';
  var choices=document.createElement('div'); choices.className='theme-choices';
  THEME_OPTIONS.forEach(function(option){
    var button=document.createElement('button');
    button.type='button';
    button.className='theme-choice theme-'+option.id+(currentTheme()===option.id?' active':'');
    button.setAttribute('aria-pressed',currentTheme()===option.id?'true':'false');
    button.innerHTML='<span class="theme-swatch" aria-hidden="true"></span><span><b>'+option.name+'</b><small>'+option.note+'</small></span>';
    button.onclick=function(){applyTheme(option.id);shade.remove();};
    choices.appendChild(button);
  });
  var done=document.createElement('button'); done.type='button'; done.className='btn ghost wide'; done.textContent='Close';
  done.onclick=function(){shade.remove();};
  dialog.appendChild(title); dialog.appendChild(intro); dialog.appendChild(choices); dialog.appendChild(done);
  shade.appendChild(dialog); shade.onclick=function(event){if(event.target===shade)shade.remove();};
  shade.addEventListener('keydown',function(event){if(event.key==='Escape')shade.remove();});
  document.body.appendChild(shade);
  setTimeout(function(){var active=dialog.querySelector('.theme-choice.active');(active||done).focus();},0);
}
function overlay(options){
  return new Promise(function(resolve){
    var shade=document.createElement('div'); shade.className='app-overlay';
    var dialog=document.createElement('section'); dialog.className='app-dialog'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
    var title=document.createElement('h2'); title.textContent=options.title;
    var body=document.createElement('p'); body.textContent=options.body || '';
    var actions=document.createElement('div'); actions.className='dialog-actions';
    var cancel=document.createElement('button'); cancel.className='btn ghost'; cancel.textContent=options.cancelLabel || 'Cancel';
    var confirm=document.createElement('button'); confirm.className='btn '+(options.danger?'bad':''); confirm.textContent=options.confirmLabel || 'Continue';
    var input;
    dialog.appendChild(title); dialog.appendChild(body);
    if (options.input){ input=document.createElement('input'); input.className='dialog-input'; input.value=options.value || ''; input.placeholder=options.placeholder || ''; dialog.appendChild(input); }
    if (!options.notice) actions.appendChild(cancel); actions.appendChild(confirm); dialog.appendChild(actions); shade.appendChild(dialog); document.body.appendChild(shade);
    function close(value){ shade.remove(); resolve(value); }
    cancel.onclick=function(){ close(null); }; shade.onclick=function(event){ if(event.target===shade) close(null); };
    confirm.onclick=function(){ close(input ? input.value : true); };
    shade.addEventListener('keydown',function(event){ if(event.key==='Escape')close(null); if(input&&event.key==='Enter')close(input.value); });
    setTimeout(function(){ (input||confirm).focus(); },0);
  });
}
function cleanUsername(value){ return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,''); }
async function ensureCrowProfile(user){
  var profileRef=doc(db,'profiles',user.uid), existing=await getDoc(profileRef);
  if(existing.exists())return existing.data();
  var limits=await getDoc(doc(db,'app','limits'));
  if(limits.exists() && (limits.data().userCount||0)>=50){
    await overlay({title:'CrowStudies is at capacity',body:'This early version is limited to 50 accounts while the service is kept small. Please try again later.',confirmLabel:'OK',notice:true});
    await signOut(auth); return null;
  }
  while(true){
    var chosen=await overlay({title:'Choose your username',body:'This is what other people will see when you share a project. Letters, numbers, and underscores only.',input:true,placeholder:'e.g. crowbite',confirmLabel:'Create account'});
    if(chosen===null){ await signOut(auth); return null; }
    var username=cleanUsername(chosen);
    if(username.length<3||username.length>20){ await overlay({title:'Choose 3 to 20 characters',body:'Use letters, numbers, and underscores only.',confirmLabel:'Try again',notice:true}); continue; }
    var taken=await getDoc(doc(db,'usernames',username));
    if(taken.exists()){ await overlay({title:'That username is taken',body:'Try another one.',confirmLabel:'Try again',notice:true}); continue; }
    try{
      var batch=writeBatch(db);
      batch.set(profileRef,{username:username,avatarUrl:'',createdAt:serverTimestamp()});
      batch.set(doc(db,'usernames',username),{uid:user.uid,username:username});
      batch.set(doc(db,'app','limits'),{userCount:increment(1)},{merge:true});
      await batch.commit();
      return {username:username,avatarUrl:''};
    }catch(error){ await overlay({title:'That username could not be saved',body:'It may have just been claimed by someone else. Try another one.',confirmLabel:'Try again',notice:true}); }
  }
}
function showAccountMenu(button, user){
  closeAccountMenu();
  var rect=button.getBoundingClientRect(), menu=document.createElement('div'); menu.className='account-popover';
  menu.style.top=(rect.bottom+8)+'px'; menu.style.right=Math.max(12,window.innerWidth-rect.right)+'px';
  var who=document.createElement('strong'); who.textContent='@'+((cloud.profile&&cloud.profile.username)||user._profile&&user._profile.username||user.displayName||user.email||'account');
  var themes=document.createElement('button'); themes.textContent='Themes'; themes.onclick=function(){ closeAccountMenu(); openThemePicker(); };
  var settings=document.createElement('button'); settings.textContent='Account settings'; settings.onclick=function(){ closeAccountMenu(); openAccountSettings(); };
  var signout=document.createElement('button'); signout.textContent='Sign out'; signout.className='danger';
  signout.onclick=async function(){ closeAccountMenu(); if(await overlay({title:'Sign out?',body:'Your saved progress will stay in your account. You can sign in again whenever you want.',confirmLabel:'Sign out',danger:true})) cloud.signOut(); };
  menu.appendChild(who); menu.appendChild(themes); menu.appendChild(settings); menu.appendChild(signout); document.body.appendChild(menu);
}
async function validateAvatar(file){
  if(!file||['image/jpeg','image/png','image/webp'].indexOf(file.type)<0||file.size>2*1024*1024)throw new Error('Choose a JPEG, PNG, or WebP image under 2 MB.');
  var url=URL.createObjectURL(file);
  try{ var img=await new Promise(function(resolve,reject){ var image=new Image(); image.onload=function(){resolve(image);};image.onerror=reject;image.src=url; }); if(img.width>512||img.height>512)throw new Error('Avatar images must be 512 × 512 pixels or smaller.'); }finally{URL.revokeObjectURL(url);}
}
function openAccountSettings(){
  var user=cloud.user, profile=cloud.profile||{}, shade=document.createElement('div'), dialog=document.createElement('section');
  shade.className='app-overlay'; dialog.className='app-dialog'; shade.appendChild(dialog);
  dialog.innerHTML='<h2>Account settings</h2><p>Your email is private. Other people see only this username and optional picture.</p><div class="account-profile"><div class="account-avatar"></div><div><b>@'+(profile.username||'')+'</b><small>Public username</small></div></div><div class="dialog-actions"><button class="btn ghost" data-avatar>Choose picture</button><button class="btn ghost" data-remove-avatar '+(profile.avatarUrl?'':'disabled')+'>Remove picture</button><button class="btn" data-close>Done</button></div>';
  var avatar=dialog.querySelector('.account-avatar'); if(profile.avatarUrl){avatar.style.backgroundImage='url("'+profile.avatarUrl.replace(/"/g,'')+'")'; avatar.textContent='';}else avatar.textContent=initials({displayName:profile.username||user.displayName||user.email});
  dialog.querySelector('[data-close]').onclick=function(){shade.remove();};
  dialog.querySelector('[data-avatar]').onclick=function(){var input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.onchange=async function(){try{var file=input.files&&input.files[0];await validateAvatar(file);var path=ref(storage,'avatars/'+user.uid+'/avatar');await uploadBytes(path,file,{contentType:file.type});var url=await getDownloadURL(path);await updateDoc(doc(db,'profiles',user.uid),{avatarUrl:url});cloud.profile.avatarUrl=url;writeAuthHint(user);updateAuthControls(user);shade.remove();openAccountSettings();}catch(error){await overlay({title:'Picture not uploaded',body:error.message||'Try another image.',confirmLabel:'OK',notice:true});}};input.click();};
  dialog.querySelector('[data-remove-avatar]').onclick=async function(){try{await deleteObject(ref(storage,'avatars/'+user.uid+'/avatar'));await updateDoc(doc(db,'profiles',user.uid),{avatarUrl:''});cloud.profile.avatarUrl='';writeAuthHint(user);updateAuthControls(user);shade.remove();openAccountSettings();}catch(error){}};
  document.body.appendChild(shade);
}
function authHint(){
  try{ var raw=sessionStorage.getItem('crowstudies:auth-hint'); return raw?JSON.parse(raw):null; }catch(error){ return null; }
}
function writeAuthHint(user){
  try{
    if(user)sessionStorage.setItem('crowstudies:auth-hint',JSON.stringify({displayName:user.displayName||'',email:user.email||'',username:(cloud.profile&&cloud.profile.username)||'',avatarUrl:(cloud.profile&&cloud.profile.avatarUrl)||''}));
    else sessionStorage.removeItem('crowstudies:auth-hint');
  }catch(error){}
}
function updateAuthControls(user){
  document.querySelectorAll('[data-firebase-auth]').forEach(function(button){
    button.disabled = false;
    button.classList.remove('auth-pending');
    button.classList.toggle('signed-in',!!user);
    var preview=user ? (cloud.profile || user._profile || {}) : {};
    var avatar=preview.avatarUrl || '';
    button.textContent = user ? initials(preview.username?{displayName:preview.username}:user) : 'Sign in';
    button.style.backgroundImage=avatar?'url("'+avatar.replace(/"/g,'')+'")':'';
    button.classList.toggle('has-avatar',!!avatar);
    var accountName=preview.username || (user && (user.displayName || user.email)) || 'your account';
    button.title = user ? 'Open account menu for @' + accountName : 'Sign in to save progress';
    button.setAttribute('aria-label', user ? 'Open account menu for @' + accountName : 'Sign in with Google to save progress');
  });
}

const cloud = {
  user: null,
  profile: null,
  initializing: true,
  async signIn(){
    await signInWithPopup(auth, provider);
  },
  async signOut(){
    await signOut(auth);
  },
  async loadCourse(course){
    if (!cloud.user) return null;
    const snapshot = await getDoc(doc(db, 'users', cloud.user.uid, 'courses', course));
    return snapshot.exists() ? snapshot.data().progress || null : null;
  },
  async saveCourse(course, progress){
    if (!cloud.user) return;
    await setDoc(doc(db, 'users', cloud.user.uid, 'courses', course), {
      progress: progress,
      updatedAt: serverTimestamp()
    }, { merge:true });
  },
  /* Projects live in one top-level collection so more than one person can
     reach them. `members` is what the security rules read; `memberIds` and
     `invitedEmails` exist because Firestore cannot query for a map key. Course
     progress stays under the signed-in user and is never shared. */
  projectRef(projectId){ return doc(db, 'projects', projectId); },
  blocksRef(projectId){ return collection(db, 'projects', projectId, 'blocks'); },
  presenceRef(projectId){ return collection(db, 'projects', projectId, 'presence'); },
  role(project){
    if (!cloud.user || !project) return null;
    return (project.members || {})[cloud.user.uid] || null;
  },
  canEdit(project){ return ['owner','editor'].indexOf(cloud.role(project)) >= 0; },
  async listProjects(){
    if (!cloud.user) return [];
    const mine = await getDocs(query(collection(db, 'projects'), where('memberIds', 'array-contains', cloud.user.uid)));
    const list = mine.docs.map(function(snapshot){ return Object.assign({ id:snapshot.id }, snapshot.data()); });
    await Promise.all(list.map(async function(project){
      var people=project.people||{}; project.people=people;
      await Promise.all(Object.keys(project.members||{}).map(async function(uid){
        try{ var profile=await getDoc(doc(db,'profiles',uid)); if(profile.exists())people[uid]=Object.assign({},people[uid]||{},{name:profile.data().username,avatarUrl:profile.data().avatarUrl||''}); }catch(error){}
      }));
    }));
    list.sort(function(a, b){ return (b.updatedAt && b.updatedAt.seconds || 0) - (a.updatedAt && a.updatedAt.seconds || 0); });
    return list;
  },
  /* Anything left for this address by someone else, not yet accepted. */
  async listInvites(){
    if (!cloud.user || !cloud.user.email) return [];
    const mine = String(cloud.user.email).toLowerCase();
    const waiting = await getDocs(query(collection(db, 'projects'), where('invitedEmails', 'array-contains', mine)));
    return waiting.docs.map(function(snapshot){ return Object.assign({ id:snapshot.id }, snapshot.data()); });
  },
  /* Taking up an invitation writes one membership entry and clears the
     address. The rules check you touched nothing else. */
  async acceptInvite(projectId, role){
    if (!cloud.user) throw new Error('Sign in first');
    const mine = String(cloud.user.email).toLowerCase();
    const seat = {};
    seat['members.' + cloud.user.uid] = role || 'editor';
    seat.memberIds = arrayUnion(cloud.user.uid);
    seat['invites.' + mine.replace(/\./g, '%2E')] = deleteField();
    seat.invitedEmails = arrayRemove(mine);
    seat['people.' + cloud.user.uid] = { name:cloud.user.displayName || cloud.user.email || 'Someone', email:cloud.user.email || '' };
    await updateDoc(cloud.projectRef(projectId), seat);
  },
  async invite(projectId, username, role){
    if (!cloud.user) throw new Error('Sign in first');
    const clean = cleanUsername(username);
    const handle = await getDoc(doc(db,'usernames',clean));
    if (!handle.exists()) throw new Error('Unknown username');
    const uid=handle.data().uid;
    const profile=await getDoc(doc(db,'profiles',uid));
    const entry={};
    entry['members.'+uid]=role||'editor';
    entry.memberIds=arrayUnion(uid);
    entry['people.'+uid]={ name:(profile.exists()&&profile.data().username)||clean };
    entry.updatedAt=serverTimestamp();
    await updateDoc(cloud.projectRef(projectId),entry);
  },
  async withdrawInvite(projectId, email){
    const entry = {};
    entry['invites.' + String(email).replace(/\./g, '%2E')] = deleteField();
    entry.invitedEmails = arrayRemove(email);
    await updateDoc(cloud.projectRef(projectId), entry);
  },
  async removeMember(projectId, uid){
    const entry = {};
    entry['members.' + uid] = deleteField();
    entry.memberIds = arrayRemove(uid);
    entry.updatedAt = serverTimestamp();
    await updateDoc(cloud.projectRef(projectId), entry);
  },
  async setRole(projectId, uid, role){
    const entry = {};
    entry['members.' + uid] = role;
    entry.updatedAt = serverTimestamp();
    await updateDoc(cloud.projectRef(projectId), entry);
  },
  async createProject(title){
    if (!cloud.user) throw new Error('Sign in first');
    const members = {}; members[cloud.user.uid] = 'owner';
    const names = {}; names[cloud.user.uid] = { name:(cloud.profile&&cloud.profile.username)||'someone' };
    const created = await addDoc(collection(db, 'projects'), {
      title: title || 'Untitled project', sections: [],
      owner: cloud.user.uid, members: members, memberIds: [cloud.user.uid],
      people: names, invites: {}, invitedEmails: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    return created.id;
  },
  async saveProject(projectId, data){
    if (!cloud.user) throw new Error('Sign in first');
    await updateDoc(cloud.projectRef(projectId), Object.assign({}, data, { updatedAt:serverTimestamp() }));
  },
  async listBlocks(projectId){
    if (!cloud.user) return [];
    const snapshots = await getDocs(query(cloud.blocksRef(projectId), orderBy('order', 'asc')));
    return snapshots.docs.map(function(snapshot){ return Object.assign({ id:snapshot.id }, snapshot.data()); });
  },
  async saveBlock(projectId, blockId, data){
    if (!cloud.user) throw new Error('Sign in first');
    const payload = Object.assign({}, data, { updatedAt:serverTimestamp(), updatedBy:cloud.user.uid });
    delete payload.pending;
    await setDoc(doc(db, 'projects', projectId, 'blocks', blockId), payload, { merge:true });
  },
  /* Text edits must write only their changed field. Sending a whole stale
     block would let a title edit overwrite somebody else's body edit. */
  async patchBlock(projectId, blockId, changes){
    if (!cloud.user) throw new Error('Sign in first');
    const payload = Object.assign({}, changes, { updatedAt:serverTimestamp(), updatedBy:cloud.user.uid });
    delete payload.id; delete payload.pending;
    await setDoc(doc(db, 'projects', projectId, 'blocks', blockId), payload, { merge:true });
  },
  async deleteBlock(projectId, blockId){
    if (!cloud.user) throw new Error('Sign in first');
    await deleteDoc(doc(db, 'projects', projectId, 'blocks', blockId));
    await updateDoc(cloud.projectRef(projectId), { updatedAt:serverTimestamp() });
  },
  async savePresence(projectId, state){
    if (!cloud.user || !projectId) return;
    await setDoc(doc(db, 'projects', projectId, 'presence', cloud.user.uid), Object.assign({
      name:(cloud.profile&&cloud.profile.username)||'someone',
      avatarUrl:(cloud.profile&&cloud.profile.avatarUrl)||'',
      updatedMs:Date.now()
    }, state), { merge:true });
  },
  commentsRef(projectId){ return collection(db, 'projects', projectId, 'comments'); },
  historyRef(projectId){ return collection(db, 'projects', projectId, 'history'); },
  collabRef(projectId, blockId){ return doc(db, 'projects', projectId, 'collab', blockId); },
  collabUpdatesRef(projectId, blockId){ return collection(db, 'projects', projectId, 'collab', blockId, 'updates'); },
  async listComments(projectId, blockId){
    const snapshots=await getDocs(query(cloud.commentsRef(projectId), orderBy('createdMs','asc')));
    return snapshots.docs.map(function(entry){ return Object.assign({id:entry.id},entry.data()); }).filter(function(item){return item.blockId===blockId;});
  },
  async addComment(projectId, blockId, text){
    if(!cloud.user)throw new Error('Sign in first');
    const value=String(text||'').trim(); if(!value)return;
    await addDoc(cloud.commentsRef(projectId),{blockId:blockId,text:value,author:(cloud.profile&&cloud.profile.username)||'someone',authorId:cloud.user.uid,createdMs:Date.now()});
  },
  async uploadProjectImage(projectId, slot, file){
    if(!cloud.user)throw new Error('Sign in first');
    if(!/^image-(0[1-9]|1[0-9]|20)$/.test(String(slot||'')))throw new Error('This project has no image slot available.');
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG, or WebP image.');
    if(file.size>1536*1024)throw new Error('Images must be 1.5 MB or smaller.');
    const target=ref(storage,'projects/'+projectId+'/images/'+slot);
    await uploadBytes(target,file,{contentType:file.type});
    return {slot:slot,url:await getDownloadURL(target)};
  },
  async deleteProjectImage(projectId, slot){
    if(!cloud.user||!/^image-(0[1-9]|1[0-9]|20)$/.test(String(slot||'')))return;
    try{await deleteObject(ref(storage,'projects/'+projectId+'/images/'+slot));}catch(error){}
  },
  async listHistory(projectId){
    const snapshots=await getDocs(query(cloud.historyRef(projectId),orderBy('createdMs','desc')));
    return snapshots.docs.map(function(entry){return Object.assign({id:entry.id},entry.data());});
  },
  async saveHistory(projectId, label, snapshot){
    if(!cloud.user)throw new Error('Sign in first');
    await addDoc(cloud.historyRef(projectId),{label:String(label||'Checkpoint'),snapshot:snapshot,author:(cloud.profile&&cloud.profile.username)||'someone',authorId:cloud.user.uid,createdMs:Date.now()});
  },
  async ensureCollabText(projectId, blockId, seed){
    const target=cloud.collabRef(projectId,blockId), existing=await getDoc(target);
    if(existing.exists())return String(existing.data().seed||'');
    await setDoc(target,{seed:String(seed||''),createdMs:Date.now(),createdBy:cloud.user&&cloud.user.uid||''},{merge:true});
    const settled=await getDoc(target); return settled.exists()?String(settled.data().seed||''):String(seed||'');
  },
  async listCollabUpdates(projectId, blockId){
    const snapshots=await getDocs(query(cloud.collabUpdatesRef(projectId,blockId),orderBy('createdMs','asc')));
    return snapshots.docs.map(function(entry){return Object.assign({id:entry.id},entry.data());});
  },
  async addCollabUpdate(projectId, blockId, update){
    if(!cloud.user)throw new Error('Sign in first');
    await addDoc(cloud.collabUpdatesRef(projectId,blockId),{update:update,authorId:cloud.user.uid,createdMs:Date.now()});
  },
  watchCollabUpdates(projectId, blockId, onChange, onError){
    return onSnapshot(query(cloud.collabUpdatesRef(projectId,blockId),orderBy('createdMs','asc')),function(snapshot){
      onChange(snapshot.docs.map(function(entry){return Object.assign({id:entry.id},entry.data());}));
    },onError||function(){});
  },
  watchPresence(projectId, onChange, onError){
    return onSnapshot(cloud.presenceRef(projectId), function(snapshot){
      onChange(snapshot.docs.map(function(entry){ return Object.assign({ id:entry.id }, entry.data()); }));
    }, onError || function(){});
  },
  /* Live updates. Both return an unsubscribe function. */
  watchProject(projectId, onChange, onError){
    return onSnapshot(cloud.projectRef(projectId), function(snapshot){
      onChange(snapshot.exists() ? Object.assign({ id:snapshot.id }, snapshot.data()) : null);
    }, onError || function(){});
  },
  watchBlocks(projectId, onChange, onError){
    return onSnapshot(query(cloud.blocksRef(projectId), orderBy('order', 'asc')), function(snapshot){
      onChange(snapshot.docs.map(function(entry){ return Object.assign({ id:entry.id }, entry.data()); }),
        snapshot.metadata.hasPendingWrites);
    }, onError || function(){});
  },
  watchProjects(onChange, onError){
    if (!cloud.user) return function(){};
    return onSnapshot(query(collection(db, 'projects'), where('memberIds', 'array-contains', cloud.user.uid)), function(snapshot){
      const list = snapshot.docs.map(function(entry){ return Object.assign({ id:entry.id }, entry.data()); });
      Promise.all(list.map(async function(project){
        var people=project.people||{}; project.people=people;
        await Promise.all(Object.keys(project.members||{}).map(async function(uid){
          try{ var profile=await getDoc(doc(db,'profiles',uid)); if(profile.exists())people[uid]=Object.assign({},people[uid]||{},{name:profile.data().username,avatarUrl:profile.data().avatarUrl||''}); }catch(error){}
        }));
      })).then(function(){
        list.sort(function(a, b){ return (b.updatedAt && b.updatedAt.seconds || 0) - (a.updatedAt && a.updatedAt.seconds || 0); });
        onChange(list);
      });
    }, onError || function(){});
  },
  async deleteProject(projectId){
    if (!cloud.user) throw new Error('Sign in first');
    const blockSnapshots = await getDocs(cloud.blocksRef(projectId));
    await Promise.all(blockSnapshots.docs.map(function(snapshot){ return deleteDoc(snapshot.ref); }));
    await deleteDoc(cloud.projectRef(projectId));
  },
  /* Projects used to live under the person who made them. Anything still there
     is copied across once; the originals are left alone as a safety net. */
  async migrateOwnProjects(){
    if (!cloud.user) return 0;
    const older = await getDocs(collection(db, 'users', cloud.user.uid, 'projects'));
    if (older.empty) return 0;
    let moved = 0;
    for (const entry of older.docs){
      const data = entry.data();
      if (data.movedTo) continue;
      const members = {}; members[cloud.user.uid] = 'owner';
      const names = {}; names[cloud.user.uid] = { name:(cloud.profile&&cloud.profile.username)||'someone' };
      const fresh = doc(collection(db, 'projects'));
      /* The project has to land before its blocks do. A block's rule looks the
         project up, and a batch is judged against the database as it was before
         the batch, so blocks written alongside their own project are refused. */
      await setDoc(fresh, {
        title: data.title || 'Untitled project', sections: data.sections || [],
        owner: cloud.user.uid, members: members, memberIds: [cloud.user.uid],
        people: names, invites: {}, invitedEmails: [],
        createdAt: data.createdAt || serverTimestamp(), updatedAt: data.updatedAt || serverTimestamp()
      });
      const blocks = await getDocs(collection(db, 'users', cloud.user.uid, 'projects', entry.id, 'blocks'));
      for (let at = 0; at < blocks.docs.length; at += 400){
        const batch = writeBatch(db);
        blocks.docs.slice(at, at + 400).forEach(function(block){ batch.set(doc(fresh, 'blocks', block.id), block.data()); });
        await batch.commit();
      }
      await updateDoc(entry.ref, { movedTo: fresh.id });
      moved++;
    }
    return moved;
  }

};

window.CrowCloud = cloud;
window.CrowUI = { confirm:function(options){ return overlay(options); },
  prompt:function(options){ return overlay(Object.assign({},options,{input:true})); },
  notice:function(options){ return overlay(Object.assign({confirmLabel:'OK'},options,{notice:true})); } };
/* This is visual only. Firebase remains the authority for real access. */
var rememberedUser=authHint();
if(rememberedUser){ rememberedUser._profile=rememberedUser; updateAuthControls(rememberedUser); }

document.addEventListener('click', function(event){
  const button = event.target.closest('[data-firebase-auth]');
  if (!button) return;
  event.preventDefault();
  if (cloud.initializing) return;
  if (cloud.user){ if(document.querySelector('.account-popover')) closeAccountMenu(); else showAccountMenu(button,cloud.user); return; }
  button.disabled = true;
  cloud.signIn().catch(function(error){
    button.disabled = false;
    alert(error.code === 'auth/operation-not-allowed'
      ? 'Google sign-in is not enabled in Firebase yet.'
      : 'Sign-in could not finish. Please try again.');
  });
});
document.addEventListener('pointerdown',function(event){ var menu=document.querySelector('.account-popover'); if(menu&&!menu.contains(event.target)&&!event.target.closest('[data-firebase-auth]'))closeAccountMenu(); });
onAuthStateChanged(auth, async function(user){
  cloud.initializing = false;
  cloud.user = user || null;
  cloud.profile = user ? await ensureCrowProfile(user) : null;
  if(user&&!cloud.profile){ cloud.user=null; }
  writeAuthHint(cloud.user);
  updateAuthControls(cloud.user);
  window.dispatchEvent(new CustomEvent('crow-auth-state', { detail:{ user:cloud.user, profile:cloud.profile } }));
});
