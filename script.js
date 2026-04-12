/* ═══════════════════════════════════════════
   FIREBASE CONFIG
   ═══════════════════════════════════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyDUXdB_-yK5QwAoheH5lhbJnyQJmP12uwM",
  authDomain: "groove-stathub.firebaseapp.com",
  projectId: "groove-stathub",
  storageBucket: "groove-stathub.firebasestorage.app",
  messagingSenderId: "611877026399",
  appId: "1:611877026399:web:233a976cceba5fe35a39ea",
  measurementId: "G-DGRN12PHP1"
};

const firebaseReady = firebaseConfig.apiKey !== "YOUR_API_KEY";
let fb, auth, db, storage = null, currentUser = null;

if (firebaseReady) {
  fb = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
}

/* ═══ ADMIN ALLOWLIST ═══
   Only these email addresses can create/edit content.
   Everyone else gets read-only access.*/
const ADMIN_EMAILS = [
  'kadeastewart@gmail.com',
  'harry.breault@gmail.com'
];

const PLAYER_EMAILS = [
  'dtk0329@gmail.com',
  'harry.breault@gmail.com',
  'erlis.martinez@gmail.com',
  'zacharylodato5@gmail.com',
  'christopher.joseph.han@gmail.com',
  'daleh242@gmail.com',
  'ericjjemba@gmail.com',
  'montanaleonard@gmail.com',
  'ryanbaez722@gmail.com',
  'charles.manfredi92@gmail.com',
  'chrislung8@gmail.com',
  'arikaputkin@gmail.com',
  'tmarchetti95@gmail.com',
  'emilio_lara02@hotmail.com',
  'velozjeury@gmail.com',
  'egoldfisch@gmail.com',
  'kadeastewart@gmail.com',
  'pbavasi@mac.com',
  'melissa.carmody@gmail.com'
];

function isAdmin(){
  if(!firebaseReady) return true;
  if(!currentUser) return false;
  return ADMIN_EMAILS.includes(currentUser.email);
}
function isPlayer(){
  if(!currentUser) return false;
  return PLAYER_EMAILS.includes(currentUser.email.toLowerCase());
}
function isSignedIn(){return !!currentUser}
function ownRosterIndex(){
  // Find the roster entry linked to the current user's email
  if(!currentUser)return -1;
  const email=currentUser.email.toLowerCase();
  return D.roster.findIndex(r=>r.email&&r.email.toLowerCase()===email);
}

/* ═══ SEASON MANAGEMENT ═══ */
const SEASONS = ['2024','2025','2026'];
let activeSeason = '2026'; // default

function STORE() { return 'groove-stathub-' + activeSeason }
function DOC_ID() { return activeSeason }

function switchSeason(year) {
  if (year === activeSeason) return;
  if(_editContext && isDirty()){
    if(!confirm('You have unsaved changes. Discard them?')) return;
    applySnapshot(JSON.parse(_snapshot));
  }
  exitEditContext();
  // Don't reset teaser animation — only plays once on first load

  // Crossfade transition
  const wrap = document.querySelector('.page-wrap');
  const badge = document.getElementById('showcaseBadge');
  wrap.style.transition = 'opacity 0.3s ease';
  wrap.style.opacity = '0';

  setTimeout(() => {
    // Stop listening to old season
    stopRealtimeSync();
    activeSeason = year;
    activeGame = null;
    activeTab = 'home';
    openComments = {};
    expandedRoster = {};

    if (year === '2025') {
      // 2025 is a static season — no Firestore data
      renderAll();
      requestAnimationFrame(() => {
        wrap.style.opacity = '1';
        setTimeout(() => { wrap.style.transition = ''; }, 300);
      });
    } else {
      // Load season data from Firestore
      loadData(() => {
        renderAll();
        if (firebaseReady && currentUser) startRealtimeSync();
        autoFillWeather();
        requestAnimationFrame(() => {
          wrap.style.opacity = '1';
          setTimeout(() => { wrap.style.transition = ''; }, 300);
        });
      });
    }
  }, 300);
}

const DEFAULT_STATS=[{id:'pa',label:'PA',full:'Plate Appearances',on:true},{id:'ab',label:'AB',full:'At Bats',on:true},{id:'r',label:'R',full:'Runs',on:true},{id:'h',label:'H',full:'Hits',on:true},{id:'singles',label:'1B',full:'Singles',on:true},{id:'doubles',label:'2B',full:'Doubles',on:true},{id:'triples',label:'3B',full:'Triples',on:true},{id:'hr',label:'HR',full:'Home Runs',on:true},{id:'rbi',label:'RBI',full:'RBI',on:true},{id:'bb',label:'BB',full:'Walks',on:true},{id:'so',label:'K',full:'Strikeouts',on:true},{id:'hbp',label:'HBP',full:'Hit-by-Pitch',on:true},{id:'sf',label:'SF',full:'Sac Flies',on:true},{id:'sb',label:'SB',full:'Stolen Bases',on:true},{id:'cs',label:'CS',full:'Caught Stealing',on:true},{id:'gidp',label:'GIDP',full:'Grounded Into DP',on:true}];
const DEFAULT_CFG={teamName:'NY Groove',seasonLabel:'2026',stats:DEFAULT_STATS,journalSections:[],statNotes:"Note: Does not count rainouts.\n\nRBIs may be incomplete for early-season games.",showHome:true,showRoster:true,showBoxScores:true,showPlayerStats:true,showLeaderboards:true,showTrendTracker:true,showStatNotes:true,messageToClaude:'',messageToHarry:'',customNotes:''};
let D={cfg:{...DEFAULT_CFG},games:[],roster:[],posts:[]};
let activeTab='home',activeGame=null,trendStats=new Set(['rbi']),trendPlayer='team',settingsSub='general',trendChartInstance=null;
let composerType='recap',composerData={},composerGameId=null,editingPostId=null;
let playerStatsSort={col:null,dir:'desc'};
let openComments={};
let expandedRoster={}; // rosterId -> true

function uid(){return Math.random().toString(36).slice(2,10)}
function n(v){const p=parseFloat(v);return isNaN(p)?0:p}
function avg3(h,ab){return ab>0?(h/ab).toFixed(3):'—'}
function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function enabledStats(){return(D.cfg.stats||[]).filter(s=>s.on)}
function autoResize(el){el.style.height='0';el.style.height=Math.max(el.scrollHeight,parseInt(el.style.minHeight||'160'))+'px'}

/* ═══ IMAGE RESIZE + UPLOAD ═══ */
let pendingUploads=0;
function resizeImage(file,maxDim){
  return new Promise(resolve=>{
    const isPng=file.type==='image/png'||/\.png$/i.test(file.name||'');
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxDim||h>maxDim){
          if(w>h){h=Math.round(h*(maxDim/w));w=maxDim}
          else{w=Math.round(w*(maxDim/h));h=maxDim}
        }
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        if(isPng){c.toBlob(blob=>resolve(blob),'image/png')}
        else{c.toBlob(blob=>resolve(blob),'image/jpeg',0.8)}
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadPhoto(blob,filename){
  if(!storage){
    // Fallback to base64 for local dev
    return new Promise(resolve=>{
      const r=new FileReader();r.onload=e=>resolve(e.target.result);r.readAsDataURL(blob);
    });
  }
  const path=`photos/${activeSeason}/${uid()}-${filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const ref=storage.ref(path);
  const meta={contentType:blob.type||'image/jpeg'};
  const snap=await ref.put(blob,meta);
  return snap.ref.getDownloadURL();
}

/* ═══ PLAYER NAME CHIPS ═══ */
// Build a lookup: lowercase name/alias/first-name -> {name, number, photo, position, walkupSong}
function rosterMap(){
  const m={};
  D.roster.forEach(r=>{
    if(!r.name)return;
    const entry={name:r.name,number:r.number||'',photo:r.photo||'',position:r.position||'',walkupSong:r.walkupSong||''};
    // Full name
    m[r.name.trim().toLowerCase()]=entry;
    // Aliases
    (r.aliases||[]).forEach(a=>{if(a&&a.trim())m[a.trim().toLowerCase()]=entry});
    // First name (only if unique — avoid collisions)
    const first=r.name.trim().toLowerCase().split(/\s+/)[0];
    if(first&&!m[first])m[first]=entry;
  });
  return m;
}
function chipHoverHtml(entry){
  const isCutout=entry.photo&&/\.png/i.test(entry.photo);
  let photoHtml;
  if(entry.photo&&isCutout){
    photoHtml=`<img class="pc-hover-photo-cutout" src="${entry.photo}">`;
  }else if(entry.photo){
    photoHtml=`<img class="pc-hover-photo-circle" src="${entry.photo}">`;
  }else{
    photoHtml=`<div class="pc-hover-photo-none"><span class="material-symbols-outlined">person</span></div>`;
  }
  let h='<div class="pc-hover">';
  h+=`<div class="pc-hover-top">`;
  h+=`<div class="pc-hover-info">`;
  if(entry.number)h+=`<div class="pc-hover-number">#${esc(entry.number)}</div>`;
  h+=`<div class="pc-hover-name">${esc(entry.name)}</div>`;
  if(entry.position)h+=`<div class="pc-hover-meta">${esc(entry.position)}</div>`;
  h+=`</div>`;
  h+=`<div class="pc-hover-photo-wrap">${photoHtml}</div>`;
  h+=`</div>`;
  // Song section
  if(entry.walkupSong&&spotifyTrackId(entry.walkupSong)){
    h+=`<div class="pc-hover-bottom"><div class="pc-hover-song" data-spotify="${spotifyTrackId(entry.walkupSong)}"></div></div>`;
  }else if(entry.walkupSong){
    h+=`<div style="font-size:10px;color:var(--acc);padding:8px 16px;font-weight:600">🎵 ${esc(entry.walkupSong)}</div>`;
  }
  h+='</div>';
  return h;
}
// Render a player name as a highlighted chip if they're on the roster
function playerChip(name){
  if(!name)return '';
  const rm=rosterMap();
  const entry=rm[name.trim().toLowerCase()];
  if(entry){
    let avatar='';
    if(entry.photo){
      const isCutout=/\.png/i.test(entry.photo);
      avatar=isCutout?`<img class="pc-avatar-cutout" src="${entry.photo}">`:`<img class="pc-avatar" src="${entry.photo}">`;
    }
    return `<span class="player-chip">${avatar}${esc(entry.name)}${entry.number?'<span class="pc-num">#'+esc(entry.number)+'</span>':''}${chipHoverHtml(entry)}</span>`;
  }
  return esc(name);
}

/* ═══ ROSTER MATCHING ═══ */
// Resolve a player name to a roster entry, returns {rosterId, name} or null
function matchRoster(inputName){
  if(!inputName)return null;
  const q=inputName.trim().toLowerCase();
  // 1. Exact match on full name
  const exact=D.roster.find(r=>r.name&&r.name.trim().toLowerCase()===q);
  if(exact)return {rosterId:exact.id,name:exact.name};
  // 2. Alias match — check each roster entry's aliases array
  const aliasMatch=D.roster.filter(r=>(r.aliases||[]).some(a=>a.trim().toLowerCase()===q));
  if(aliasMatch.length===1)return {rosterId:aliasMatch[0].id,name:aliasMatch[0].name};
  // 3. First-name match (input is a first name, roster has full name)
  const firstMatches=D.roster.filter(r=>r.name&&r.name.trim().toLowerCase().split(/\s+/)[0]===q);
  if(firstMatches.length===1)return {rosterId:firstMatches[0].id,name:firstMatches[0].name};
  // 4. Roster name starts with input or input starts with roster name
  const partial=D.roster.filter(r=>r.name&&(r.name.trim().toLowerCase().startsWith(q)||q.startsWith(r.name.trim().toLowerCase())));
  if(partial.length===1)return {rosterId:partial[0].id,name:partial[0].name};
  return null;
}
// Get the display name for a box score player — prefer linked roster name
function playerDisplayName(p){
  if(p.rosterId){
    const r=D.roster.find(x=>x.id===p.rosterId);
    if(r&&r.name)return r.name;
  }
  return p.name||'';
}
// Replace roster player names in free text with chips
function chipifyText(text){
  if(!text)return '';
  const rm=rosterMap();
  let safe=esc(text);
  // Bold **text** and italic *text* (bold first to avoid conflict)
  safe=safe.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  safe=safe.replace(/\*(.+?)\*/g,'<em>$1</em>');
  // Sort names longest-first to avoid partial matches
  const names=Object.values(rm).sort((a,b)=>b.name.length-a.name.length);
  // First occurrence only, and skip names inside <strong> or <em> tags
  const chipped=new Set();
  names.forEach(r=>{
    const escaped=esc(r.name);
    const reStr=escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp('\\b'+reStr+'\\b','gi');
    let avatar='';
    if(r.photo){const isCut=/\.png/i.test(r.photo);avatar=isCut?`<img class="pc-avatar-cutout" src="${r.photo}">`:`<img class="pc-avatar" src="${r.photo}">`}
    const chip=`<span class="player-chip">${avatar}${escaped}${r.number?'<span class="pc-num">#'+esc(r.number)+'</span>':''}${chipHoverHtml(r)}</span>`;
    const key=r.name.toLowerCase();
    safe=safe.replace(re,(match,offset)=>{
      if(chipped.has(key))return match;
      // Check if inside <strong>...</strong> or <em>...</em>
      const before=safe.substring(0,offset);
      const strongOpen=(before.match(/<strong>/g)||[]).length;
      const strongClose=(before.match(/<\/strong>/g)||[]).length;
      if(strongOpen>strongClose)return match;
      const emOpen=(before.match(/<em>/g)||[]).length;
      const emClose=(before.match(/<\/em>/g)||[]).length;
      if(emOpen>emClose)return match;
      chipped.add(key);
      return chip;
    });
  });
  return safe;
}

function fmtDate(ts){
  if(!ts)return '';
  const d=new Date(typeof ts==='number'?ts:ts+'T12:00:00');
  if(isNaN(d))return ts;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon=months[d.getMonth()];const day=d.getDate();
  let hr=d.getHours();const min=d.getMinutes().toString().padStart(2,'0');
  const ampm=hr>=12?'pm':'am';hr=hr%12||12;
  return `${mon} ${day} @ ${hr}:${min}${ampm} ET`;
}
function fmtDateShort(ts){
  if(!ts)return '';
  const d=new Date(typeof ts==='number'?ts:ts+'T12:00:00');
  if(isNaN(d))return ts;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
function fmtTime(t){
  if(!t)return '';
  const [h,m]=t.split(':').map(Number);
  const ampm=h>=12?'PM':'AM';
  const h12=h%12||12;
  return m?`${h12}:${String(m).padStart(2,'0')} ${ampm}`:`${h12} ${ampm}`;
}
function fmtGameDate(ts){
  if(!ts)return '';
  const d=new Date(typeof ts==='number'?ts:ts+'T12:00:00');
  if(isNaN(d))return ts;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function resolveLocation(post){
  if(post.location)return post.location;
  if(post.gameId){const g=D.games.find(x=>x.id===post.gameId);if(g&&g.location)return g.location}
  return '';
}
function mapsUrl(loc){return 'https://www.google.com/maps/search/'+encodeURIComponent(loc)}
function playerPhoto(name){
  if(!name)return '';
  const key=name.trim().toLowerCase();
  const r=D.roster.find(x=>x.name&&x.name.trim().toLowerCase()===key);
  return r&&r.photo?r.photo:'';
}
function playerPhotoHtml(name,size){
  const sz=size||20;
  const photo=playerPhoto(name);
  if(!photo)return `<span style="display:inline-block;width:${sz}px;height:${sz}px;border-radius:50%;background:#e0ddd5;vertical-align:middle;margin-right:4px;flex-shrink:0"></span>`;
  return `<img src="${photo}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;flex-shrink:0">`;
}

/* ═══ AUTO-FETCH HISTORICAL WEATHER ═══ */
const WEATHER_CODES={0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',
  45:'Foggy',48:'Foggy',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',
  61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',
  80:'Light Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',96:'Thunderstorm w/ Hail',99:'Thunderstorm w/ Hail'};

// Approximate coordinates for known NYC parks; fallback to Central Park
function locToCoords(loc){
  const l=(loc||'').toLowerCase();
  if(/inwood/i.test(l)) return {lat:40.8681,lon:-73.9253};
  if(/randall/i.test(l)) return {lat:40.7935,lon:-73.9218};
  if(/central\s*park/i.test(l)) return {lat:40.7829,lon:-73.9654};
  if(/riverside/i.test(l)) return {lat:40.8010,lon:-73.9712};
  if(/east\s*river/i.test(l)) return {lat:40.7681,lon:-73.9676};
  if(/van\s*cortlandt/i.test(l)) return {lat:40.8932,lon:-73.8986};
  if(/prospect/i.test(l)) return {lat:40.6602,lon:-73.9690};
  if(/red\s*hook/i.test(l)) return {lat:40.6726,lon:-74.0060};
  if(/mccarren/i.test(l)) return {lat:40.7200,lon:-73.9510};
  if(/domino/i.test(l)) return {lat:40.7135,lon:-73.9680};
  // Default: NYC midtown
  return {lat:40.7580,lon:-73.9855};
}

const _weatherCache={};
async function fetchGameWeather(game){
  if(!game.date||!game.location) return null;
  const key=game.date+'|'+game.location;
  if(_weatherCache[key]) return _weatherCache[key];
  const {lat,lon}=locToCoords(game.location);
  try{
    const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${game.date}&end_date=${game.date}&daily=temperature_2m_max,temperature_2m_min,weathercode&hourly=temperature_2m,relative_humidity_2m,weathercode&temperature_unit=fahrenheit&timezone=America/New_York`;
    const res=await fetch(url);
    if(!res.ok) return null;
    const data=await res.json();
    // Use game time if available, otherwise default to ~6pm
    const hi=data.hourly;
    const gameHour=game.time?parseInt(game.time.split(':')[0]):18;
    const tempF=hi&&hi.temperature_2m?Math.round(hi.temperature_2m[gameHour]):null;
    const humid=hi&&hi.relative_humidity_2m?hi.relative_humidity_2m[gameHour]:null;
    const wcode=hi&&hi.weathercode?hi.weathercode[gameHour]:null;
    const cond=WEATHER_CODES[wcode]||'';
    let result=[];
    if(tempF!==null) result.push(tempF+'°F');
    if(cond) result.push(cond);
    if(humid!==null&&humid>70) result.push('Humid');
    const str=result.join(', ');
    _weatherCache[key]=str;
    return str;
  }catch(e){return null}
}

// Auto-populate weather for all games that don't have it
async function autoFillWeather(){
  let changed=false;
  for(const g of D.games){
    if(g.weather||!g.date||!g.location) continue;
    const w=await fetchGameWeather(g);
    if(w){g.weather=w;changed=true}
  }
  if(changed){saveNow();renderFeed()}
}

/* ═══ TEAM RECORD ═══ */
function getRecord(){
  let w=0,l=0,t=0;
  D.games.forEach(g=>{
    const rf=n(g.runsFor),ra=n(g.runsAgainst);
    if(!g.runsFor&&!g.runsAgainst) return;
    if(rf>ra)w++;else if(rf<ra)l++;else t++;
  });
  return {w,l,t};
}

/* ═══ 2025 SEASON DATA (no box scores — just results) ═══ */
const SEASON_2025 = [
  {date:'Apr 19',opponent:'FUMBL',type:'away',result:'L',score:'16-8'},
  {date:'May 3',opponent:'Brooklyn Bad Stars',type:'home',result:'W',score:'8-7'},
  {date:'May 17',opponent:'Asbury Park Bennys',type:'home',result:'L',score:'12-7'},
  {date:'May 23',opponent:'Carolina Kudzu',type:'away',result:'L',score:'20-6'},
  {date:'May 25',opponent:'Neuse River 9',type:'away',result:'L',score:'12-9'},
  {date:'May 31',opponent:'FUMBL',type:'away',result:'Rainout',score:''},
  {date:'Jun 7',opponent:'FUMBL',type:'home',result:'Rainout',score:''},
  {date:'Jun 21',opponent:'FUMBL',type:'home',result:'W',score:'5-4'},
  {date:'Jul 5',opponent:'Open Sandlot',type:'home',result:'',score:''},
  {date:'Jul 12',opponent:'Asbury Park Bennys',type:'away',result:'W',score:'10-9'},
  {date:'Jul 19',opponent:'Brooklyn Bad Stars',type:'home',result:'W',score:'18-7'},
  {date:'Jul 26',opponent:'Brooklyn Bad Stars',type:'home',result:'W',score:'18-14'},
  {date:'Aug 9',opponent:'Brooklyn Bad Stars',type:'home',result:'L',score:'3-2'},
  {date:'Aug 16',opponent:'Brooklyn Books',type:'home',result:'W',score:'16-8'},
  {date:'Aug 23',opponent:'FUMBL',type:'home',result:'W',score:'18-7'},
  {date:'Aug 24',opponent:'Oak Cliff 86ers',type:'home',result:'W',score:'14-2'},
  {date:'Sep 6',opponent:'FUMBL',type:'home',result:'W',score:'16-8'},
  {date:'Sep 13',opponent:'Brooklyn Books',type:'away',result:'W',score:'12-5'},
  {date:'Sep 20',opponent:'FUMBL',type:'home',result:'L',score:'11-9'},
  {date:'Sep 21',opponent:'Cap City Cobras',type:'home',result:'L',score:'11-8'},
  {date:'Oct 4',opponent:'Cooperstown Rumble',type:'away',result:'',score:''},
  {date:'Oct 5',opponent:'Cooperstown Rumble',type:'away',result:'',score:''},
  {date:'Oct 18',opponent:'Brooklyn Bad Stars',type:'home',result:'W',score:'5-2'},
];

function get2025Record(){
  let w=0,l=0,t=0;
  SEASON_2025.forEach(g=>{
    if(g.result==='W')w++;
    else if(g.result==='L')l++;
  });
  return {w,l,t};
}

/* ═══ DATA PERSISTENCE ═══ */
let firestoreUnsubscribe = null;
let savingInProgress = false; // prevent onSnapshot feedback loop

function loadData(cb) {
  if (firebaseReady && db) {
    db.collection('stathub').doc(DOC_ID()).get().then(snap => {
      if (snap.exists) {
        applySnapshot(snap.data());
      } else {
        loadFromLocalStorage();
      }
      if (cb) cb();
    }).catch(e => {
      console.error('Firestore load failed, using localStorage:', e);
      loadFromLocalStorage();
      if (cb) cb();
    });
  } else {
    loadFromLocalStorage();
    if (cb) cb();
  }
}

function startRealtimeSync() {
  if (!firebaseReady || !db || firestoreUnsubscribe) return;
  firestoreUnsubscribe = db.collection('stathub').doc(DOC_ID()).onSnapshot(snap => {
    if (savingInProgress) return; // ignore our own writes
    if (snap.exists) {
      applySnapshot(snap.data());
      renderAll();
    }
  }, err => console.error('Realtime sync error:', err));
}

function stopRealtimeSync() {
  if (firestoreUnsubscribe) { firestoreUnsubscribe(); firestoreUnsubscribe = null; }
}

function applySnapshot(d) {
  D.cfg = { ...DEFAULT_CFG, ...(d.cfg || {}) };
  D.games = d.games || [];
  D.roster = d.roster || [];
  D.posts = d.posts || [];
  D.posts.forEach(p => { if (!p.comments) p.comments = [] });
  D.roster.forEach(r => {
    if (!r.position) r.position = '';
    if (!r.bio) r.bio = '';
    if (!r.photo) r.photo = '';
    if (!r.throws) r.throws = '';
    if (!r.bats) r.bats = '';
    if (!r.height) r.height = '';
    if (!r.hometown) r.hometown = '';
    if (!r.walkupSong) r.walkupSong = '';
    if (!r.aliases) r.aliases = [];
    if (!r.email) r.email = '';
  });
}

function loadFromLocalStorage(){
  try{const r=localStorage.getItem(STORE());if(r){applySnapshot(JSON.parse(r))}}catch(e){console.error(e)}
}

function saveNow(btn) {
  // Show saving state on the triggering button if provided
  const origText = btn ? btn.textContent : null;
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; btn.style.opacity = '0.7' }

  // Always save to localStorage as backup
  try { localStorage.setItem(STORE(), JSON.stringify(D)) } catch(e) { console.error(e) }

  // Save to Firestore if available and user is admin or player
  if (firebaseReady && db && (isAdmin() || isPlayer())) {
    savingInProgress = true;
    const payload = JSON.parse(JSON.stringify(D));
    db.collection('stathub').doc(DOC_ID()).set(payload)
      .then(() => {
        setTimeout(() => { savingInProgress = false }, 500);
        if(_editContext) takeSnapshot(); // keep save bar in sync
        if (btn) { btn.textContent = '✓ Saved'; btn.disabled = false; btn.style.opacity = '1'; setTimeout(() => { if(btn.isConnected) btn.textContent = origText }, 2000) }
      })
      .catch(e => {
        console.error('Firestore save failed:', e);
        savingInProgress = false;
        if (btn) { btn.textContent = '✗ Save failed'; btn.disabled = false; btn.style.opacity = '1'; btn.style.color = 'var(--loss)'; setTimeout(() => { if(btn.isConnected){ btn.textContent = origText; btn.style.color = '' }}, 3000) }
      });
  } else {
    // Local-only: just confirm
    if(_editContext) takeSnapshot();
    if (btn) { btn.textContent = '✓ Saved locally'; btn.disabled = false; btn.style.opacity = '1'; setTimeout(() => { if(btn.isConnected) btn.textContent = origText }, 2000) }
  }
}

/* ═══ DIRTY STATE + SAVE BAR ═══ */
let _snapshot = null; // JSON snapshot taken when entering an edit context
let _editContext = null; // 'roster' | 'boxscore' | 'statnotes' | 'settings' | null

function takeSnapshot() {
  _snapshot = JSON.stringify(D);
}
function isDirty() {
  if (!_snapshot) return false;
  return JSON.stringify(D) !== _snapshot;
}
function enterEditContext(ctx) {
  if (_editContext === ctx) return; // already in this context
  _editContext = ctx;
  takeSnapshot();
  updateSaveBar();
}
function exitEditContext() {
  _editContext = null;
  _snapshot = null;
  updateSaveBar();
}
function updateSaveBar() {
  const bar = document.getElementById('saveBar');
  if (!bar) return;
  if (!_editContext || !isAdmin()) {
    bar.classList.remove('visible', 'dirty');
    document.body.classList.remove('has-save-bar');
    return;
  }
  bar.classList.add('visible');
  document.body.classList.add('has-save-bar');
  const dirty = isDirty();
  bar.classList.toggle('dirty', dirty);
  const labels = { roster: 'Editing Roster', boxscore: 'Editing Box Score', statnotes: 'Editing Stat Notes', settings: 'Editing Settings' };
  document.getElementById('saveBarLabel').textContent = labels[_editContext] || 'Editing';
  const saveBtn = document.getElementById('saveBarSave');
  saveBtn.textContent = 'Save';
  saveBtn.disabled = false;
  saveBtn.style.color = '';
}
// Periodic dirty check while editing (for oninput mutations)
let _dirtyInterval = null;
function startDirtyWatch() {
  if (_dirtyInterval) return;
  _dirtyInterval = setInterval(() => {
    if (_editContext) updateSaveBar();
  }, 600);
}
function stopDirtyWatch() {
  if (_dirtyInterval) { clearInterval(_dirtyInterval); _dirtyInterval = null; }
}

function saveBarSave() {
  const btn = document.getElementById('saveBarSave');
  const origText = btn.textContent;
  btn.textContent = 'Saving...'; btn.disabled = true;

  // Always save to localStorage as backup
  try { localStorage.setItem(STORE(), JSON.stringify(D)) } catch(e) { console.error(e) }

  if (firebaseReady && db && isAdmin()) {
    savingInProgress = true;
    const payload = JSON.parse(JSON.stringify(D));
    db.collection('stathub').doc(DOC_ID()).set(payload)
      .then(() => {
        setTimeout(() => { savingInProgress = false }, 500);
        takeSnapshot(); // reset snapshot so dirty=false
        btn.textContent = '✓ Saved'; btn.disabled = false;
        updateSaveBar();
        setTimeout(() => { if(btn.isConnected) { btn.textContent = 'Save'; } }, 2000);
      })
      .catch(e => {
        console.error('Firestore save failed:', e);
        savingInProgress = false;
        btn.textContent = '✗ Failed'; btn.disabled = false; btn.style.color = 'var(--loss)';
        setTimeout(() => { if(btn.isConnected) { btn.textContent = 'Save'; btn.style.color = ''; } }, 3000);
      });
  } else {
    takeSnapshot();
    btn.textContent = '✓ Saved locally'; btn.disabled = false;
    updateSaveBar();
    setTimeout(() => { if(btn.isConnected) btn.textContent = 'Save' }, 2000);
  }
}

function discardEdits() {
  if (!_snapshot) { exitEditContext(); return; }
  if (isDirty()) {
    applySnapshot(JSON.parse(_snapshot));
    renderAll();
  }
  exitEditContext();
}

// Guard against accidental navigation
window.addEventListener('beforeunload', function(e) {
  if (_editContext && isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

startDirtyWatch();

/* ═══ AUTH ═══ */
function signIn(){
  if(!firebaseReady){alert('Firebase is not configured yet. See the instructions in the HTML file.');return}
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e=>console.error('Sign-in error:',e));
}
function signOut(){
  if(auth)auth.signOut();
  currentUser=null;
  document.body.classList.remove('admin-mode');
  stopRealtimeSync();
  renderAuthBar();renderAll();
}
function renderAuthBar(){
  const pill=document.getElementById('profilePill');
  if(!pill) return;
  if(!firebaseReady){
    pill.innerHTML='';
    return;
  }
  if(currentUser){
    // Determine avatar: use roster photo if available, else Google photo, else initials
    const rIdx = ownRosterIndex();
    const rosterPhoto = rIdx >= 0 && D.roster[rIdx] && D.roster[rIdx].photo ? D.roster[rIdx].photo : null;
    const avatarSrc = rosterPhoto || currentUser.photoURL;
    const avatarHtml = avatarSrc
      ? `<img class="pp-avatar" src="${esc(avatarSrc)}" referrerpolicy="no-referrer" onclick="toggleProfileMenu()" title="My Profile">`
      : `<div class="pp-placeholder" onclick="toggleProfileMenu()" title="My Profile"><span class="material-symbols-outlined" style="font-size:18px">person</span></div>`;
    pill.innerHTML = avatarHtml + `<div class="pp-menu" id="ppMenu">
      <div class="pp-name">${esc(currentUser.displayName||'')}</div>
      <div class="pp-email">${esc(currentUser.email)}</div>
      <div class="pp-menu-divider"></div>
      ${(isPlayer()||isAdmin()) && rIdx>=0 ? '<button class="pp-menu-item" onclick="openProfileEditor();closeProfileMenu()"><span class="material-symbols-outlined" style="font-size:16px">edit</span>Edit My Profile</button>':''}
      <button class="pp-menu-item danger" onclick="signOut();closeProfileMenu()"><span class="material-symbols-outlined" style="font-size:16px">logout</span>Sign Out</button>
    </div>`;
  } else {
    pill.innerHTML=`<button class="admin-signin" onclick="signIn()"><svg class="g-logo" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Sign In</button>`;
  }
}
function toggleProfileMenu(){
  const menu=document.getElementById('ppMenu');
  if(menu) menu.classList.toggle('open');
}
function closeProfileMenu(){
  const menu=document.getElementById('ppMenu');
  if(menu) menu.classList.remove('open');
}
// Close menu on outside click
document.addEventListener('click',function(e){
  const pill=document.getElementById('profilePill');
  if(pill && !pill.contains(e.target)) closeProfileMenu();
});
function isSignedIn(){return !!currentUser}

if(firebaseReady&&auth){
  auth.onAuthStateChanged(user=>{
    currentUser=user;
    renderAuthBar();
    if(user){
      loadData(()=>{renderAll();startRealtimeSync();checkProfileCompletion()});
      if(isAdmin()) document.body.classList.add('admin-mode'); else document.body.classList.remove('admin-mode');
      initGrass();
    } else {
      stopRealtimeSync();
      document.body.classList.remove('admin-mode');
    }
    renderAll();
  });
}

function recapGameIds(){return new Set(D.posts.filter(p=>p.type==='recap'&&p.gameId).map(p=>p.gameId))}

/* ═══ PROFILE EDITOR MODAL ═══ */
let _profileModalShown = false;
let _pmIdx = -1; // roster index being edited in the modal

function checkProfileCompletion(){
  if(_profileModalShown) return;
  if(!currentUser) return;
  if(!isPlayer() && !isAdmin()) return;
  const idx = ownRosterIndex();
  if(idx < 0) return;
  const r = D.roster[idx];
  const missingPhoto = !r.photo;
  const missingHometown = !r.hometown || !r.hometown.trim();
  if(!missingPhoto && !missingHometown) return;
  _profileModalShown = true;
  openProfileEditor(idx, true);
}

// Open the profile editor — called from menu or auto-prompt
// promptMode=true means we're nudging them to complete required fields
function openProfileEditor(overrideIdx, promptMode){
  const idx = typeof overrideIdx === 'number' ? overrideIdx : ownRosterIndex();
  if(idx < 0) return;
  _pmIdx = idx;
  const r = D.roster[idx];
  const missingPhoto = !r.photo;
  const missingHometown = !r.hometown || !r.hometown.trim();
  const hasRequired = !missingPhoto && !missingHometown;

  const overlay = document.getElementById('profileModalOverlay');
  const inner = document.getElementById('profileModalInner');
  let html = `<div id="pmForm">`;

  // Header
  html += `<div class="pm-header">`;
  if(promptMode && (missingPhoto || missingHometown)){
    html += `<h2>Complete Your Profile</h2>`;
    const missing = [];
    if(missingPhoto) missing.push('a photo');
    if(missingHometown) missing.push('your hometown');
    html += `<p class="pm-sub">Hey ${esc((r.name||'').split(' ')[0])}! We're missing ${missing.join(' and ')} — fill in the required fields and update anything else you'd like.</p>`;
  } else {
    html += `<h2>Edit Profile</h2>`;
    html += `<p class="pm-sub">${esc(r.name||'')}</p>`;
  }
  html += `</div>`;

  html += `<div class="pm-body">`;

  // Photo
  const photoHtml = r.photo ? `<img src="${esc(r.photo)}" referrerpolicy="no-referrer">` : '';
  html += `<div class="pm-photo-area${r.photo?' has-photo':''}${missingPhoto?' required':''}" id="pmPhotoArea" onclick="document.getElementById('pmPhotoInput').click()">`;
  html += photoHtml;
  html += `<div class="pm-photo-hint"><span class="material-symbols-outlined" style="font-size:28px">photo_camera</span>${r.photo?'Change':'Upload'} photo</div>`;
  html += `<input type="file" id="pmPhotoInput" accept="image/*" style="display:none" onchange="handleProfileModalPhoto(${idx},this.files)">`;
  html += `</div>`;
  html += `<div class="pm-photo-label">Photo <span class="pm-req" style="color:var(--acc)">*</span></div>`;

  // Required section
  html += `<div class="pm-field"><label>Hometown <span class="pm-req">*</span></label><input id="pmHometown" value="${esc(r.hometown||'')}" placeholder="City, ST"></div>`;

  // Optional section
  html += `<div class="pm-section">Optional</div>`;
  html += `<div class="pm-field-row">`;
  html += `<div class="pm-field"><label>Throws</label><input id="pmThrows" value="${esc(r.throws||'')}" placeholder="R / L / S"></div>`;
  html += `<div class="pm-field"><label>Bats</label><input id="pmBats" value="${esc(r.bats||'')}" placeholder="R / L / S"></div>`;
  html += `<div class="pm-field"><label>Height</label><input id="pmHeight" value="${esc(r.height||'')}" placeholder="6'2&quot;"></div>`;
  html += `</div>`;
  html += `<div class="pm-field"><label>Walkup Song (Spotify link)</label><input id="pmWalkup" value="${esc(r.walkupSong||'')}" placeholder="https://open.spotify.com/track/..."></div>`;
  html += `<div class="pm-field"><label>Bio</label><textarea id="pmBio" placeholder="Tell us about yourself...">${esc(r.bio||'')}</textarea></div>`;

  html += `</div>`; // end pm-body

  // Actions
  html += `<div class="pm-actions">`;
  html += `<button class="pm-save-btn" id="pmSaveBtn" onclick="saveProfileModal()">Save Profile</button>`;
  if(promptMode && !hasRequired){
    html += `<button class="pm-skip" onclick="closeProfileModal()">I'll do this later</button>`;
  } else {
    html += `<button class="pm-skip" onclick="closeProfileModal()">Cancel</button>`;
  }
  html += `</div>`;
  html += `</div>`; // end pmForm

  // Thanks state
  html += `<div class="pm-thanks" id="pmThanks">`;
  html += `<div class="pm-check"><span class="material-symbols-outlined">check</span></div>`;
  html += `<h3>Thanks!</h3>`;
  html += `<p>Your profile is looking great.</p>`;
  html += `</div>`;

  inner.innerHTML = html;
  inner.scrollTop = 0;
  overlay.classList.add('open');
}

async function handleProfileModalPhoto(idx, files){
  if(!files || !files.length) return;
  const area = document.getElementById('pmPhotoArea');
  area.innerHTML = '<div class="pm-photo-hint"><span class="material-symbols-outlined" style="font-size:28px;animation:spin 1s linear infinite">progress_activity</span>Uploading...</div><input type="file" id="pmPhotoInput" accept="image/*" style="display:none" onchange="handleProfileModalPhoto('+idx+',this.files)">';
  try {
    const f = files[0];
    const isPng = f.type === 'image/png' || /\.png$/i.test(f.name || '');
    const blob = await resizeImage(f, 300);
    const ext = isPng ? '.png' : '.jpg';
    const url = await uploadPhoto(blob, 'roster-' + D.roster[idx].id + ext);
    D.roster[idx].photo = url;
    area.classList.add('has-photo');
    area.classList.remove('required');
    area.innerHTML = `<img src="${url}"><div class="pm-photo-hint"><span class="material-symbols-outlined" style="font-size:28px">photo_camera</span>Change photo</div><input type="file" id="pmPhotoInput" accept="image/*" style="display:none" onchange="handleProfileModalPhoto(${idx},this.files)">`;
  } catch(e) {
    console.error('Profile photo upload failed:', e);
    area.innerHTML = `<div class="pm-photo-hint"><span class="material-symbols-outlined" style="font-size:28px">photo_camera</span>Upload photo</div><input type="file" id="pmPhotoInput" accept="image/*" style="display:none" onchange="handleProfileModalPhoto(${idx},this.files)">`;
  }
}

function saveProfileModal(){
  const idx = _pmIdx;
  if(idx < 0) return;
  const r = D.roster[idx];
  // Read all fields from the modal
  const v = id => { const el = document.getElementById(id); return el ? el.value : null };
  const ht = v('pmHometown'); if(ht !== null) r.hometown = ht.trim();
  const th = v('pmThrows');   if(th !== null) r.throws = th.trim();
  const ba = v('pmBats');     if(ba !== null) r.bats = ba.trim();
  const he = v('pmHeight');   if(he !== null) r.height = he.trim();
  const wu = v('pmWalkup');   if(wu !== null) r.walkupSong = wu.trim();
  const bi = v('pmBio');      if(bi !== null) r.bio = bi;

  // Save to Firestore
  savePlayerProfile();

  // Show thanks
  document.getElementById('pmForm').style.display = 'none';
  const thanks = document.getElementById('pmThanks');
  thanks.style.display = 'flex';
  setTimeout(()=>{
    closeProfileModal();
    renderAuthBar();
    renderRoster();
  }, 2000);
}

function closeProfileModal(){
  document.getElementById('profileModalOverlay').classList.remove('open');
}

// Save for players — writes the full doc to Firestore so player edits persist
function savePlayerProfile(){
  try { localStorage.setItem(STORE(), JSON.stringify(D)) } catch(e) { console.error(e) }
  if(firebaseReady && db && (isAdmin() || isPlayer())){
    const payload = JSON.parse(JSON.stringify(D));
    db.collection('stathub').doc(DOC_ID()).set(payload)
      .catch(e => console.error('Player profile save failed:', e));
  }
}

/* ═══ SIDEBAR ═══ */
const TABS=[
  {id:'home',icon:'home',label:'Feed',cfg:'showHome'},
  {id:'roster',icon:'groups',label:'Roster',cfg:'showRoster'},
  {id:'boxscores',icon:'scoreboard',label:'Box Scores',cfg:'showBoxScores'},
  {id:'playerstats',icon:'person',label:'Player Stats',cfg:'showPlayerStats'},
  {id:'leaderboards',icon:'emoji_events',label:'Leaderboards',cfg:'showLeaderboards'},
  {id:'trendtracker',icon:'trending_up',label:'TrendTracker',cfg:'showTrendTracker'},
  {id:'statnotes',icon:'sticky_note_2',label:'Stat Notes',cfg:'showStatNotes'},
];
function renderNav(){
  let html='<div class="sidebar-top">';
  if(activeSeason==='2025'){
    // 2025 only has the home tab
    html+=`<button class="nav-icon active" onclick="navTo('home')"><span class="material-symbols-outlined">home</span><span class="tip">Feed</span></button>`;
  } else {
    TABS.forEach(t=>{if(t.cfg&&!D.cfg[t.cfg])return;html+=`<button class="nav-icon${activeTab===t.id?' active':''}" onclick="navTo('${t.id}')"><span class="material-symbols-outlined">${t.icon}</span><span class="tip">${t.label}</span></button>`});
  }
  html+=`</div><div class="sidebar-bottom">`;
  if(!currentUser){
    html+=`<button class="nav-icon" onclick="signIn()" title="Sign In"><span class="material-symbols-outlined">login</span><span class="tip">Sign In</span></button>`;
  }
  if(activeSeason!=='2025') html+=`<button class="nav-icon${activeTab==='settings'?' active':''}" onclick="navTo('settings')"><span class="material-symbols-outlined">settings</span><span class="tip">Settings</span></button>`;
  html+=`</div>`;
  document.getElementById('sidebar').innerHTML=html;
}
function navTo(tab){
  if(tab===activeTab) return;
  if(_editContext && isDirty()){
    if(!confirm('You have unsaved changes. Discard them?')) return;
    applySnapshot(JSON.parse(_snapshot));
  }
  exitEditContext();
  activeTab=tab;
  renderAll();
}
function renderTabs(){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));const el=document.getElementById('tab-'+activeTab);if(el)el.classList.add('active')}

/* ═══ HEADER RECORD ═══ */
function renderRecord(){
  const rec = activeSeason === '2025' ? get2025Record() : getRecord();
  const el=document.getElementById('headerRecord');
  let parts=[];
  parts.push(`<span class="rec-w">${rec.w}W</span>`);
  parts.push(`<span class="rec-l">${rec.l}L</span>`);
  if(rec.t)parts.push(`<span class="rec-t">${rec.t}T</span>`);
  el.innerHTML=parts.join(' – ');
}

/* ═══ ROSTER PAGE ═══ */
// Extract Spotify track ID from various URL formats
function spotifyTrackId(url){
  if(!url)return null;
  const m=url.match(/track[\/:]([a-zA-Z0-9]+)/);
  return m?m[1]:null;
}
function spotifyEmbed(url){
  const id=spotifyTrackId(url);
  if(!id)return '';
  return `<iframe src="https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}
// Photo upload handler for roster headshots
async function handleRosterPhoto(idx,files){
  if(!files||!files.length)return;
  const f=files[0];
  const isPng=f.type==='image/png'||/\.png$/i.test(f.name||'');
  const blob=await resizeImage(f,300);
  const ext=isPng?'.png':'.jpg';
  const url=await uploadPhoto(blob,'roster-'+D.roster[idx].id+ext);
  D.roster[idx].photo=url;
  renderRoster();
}

// Bulk photo upload — matches filenames to roster players
async function handleBulkPhotos(files){
  if(!files||!files.length)return;
  let matched=0,skipped=[];
  for(const f of Array.from(files)){
    // Strip extension, remove trailing numbers/spaces, replace separators, lowercase
    const base=f.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ').replace(/\s*\d+\s*$/,'').trim().toLowerCase();
    // Also create a version with all spaces removed for "nickcolon" style
    const baseNoSpaces=base.replace(/\s+/g,'');
    // Try to match against roster names
    let idx=-1;
    for(let i=0;i<D.roster.length;i++){
      const rn=(D.roster[i].name||'').trim().toLowerCase();
      if(!rn)continue;
      const rnNoSpaces=rn.replace(/\s+/g,'');
      // Exact match
      if(base===rn){idx=i;break}
      // Filename contains full name or vice versa
      if(base.includes(rn)||rn.includes(base)){idx=i;break}
      // No-spaces match (nickcolon → nick colon)
      if(baseNoSpaces===rnNoSpaces){idx=i;break}
      if(baseNoSpaces.includes(rnNoSpaces)||rnNoSpaces.includes(baseNoSpaces)){idx=i;break}
      // Last name match
      const parts=rn.split(/\s+/);
      const last=parts[parts.length-1];
      if(last.length>2&&(base===last||base.includes(last))){idx=i;break}
      // First name match
      const first=parts[0];
      if(first.length>2&&(base===first||base.includes(first))){idx=i;break}
      // Check aliases
      const aliases=(D.roster[i].aliases||[]).map(a=>a.trim().toLowerCase());
      if(aliases.some(a=>base===a||base.includes(a)||a.includes(base))){idx=i;break}
    }
    if(idx>=0){
      try{
        const isPng=f.type==='image/png'||/\.png$/i.test(f.name);
        const blob=await resizeImage(f,300);
        const ext=isPng?'.png':'.jpg';
        const url=await uploadPhoto(blob,'roster-'+D.roster[idx].id+ext);
        D.roster[idx].photo=url;
        matched++;
        console.log('Matched',f.name,'→',D.roster[idx].name);
      }catch(e){
        console.error('Upload failed for',f.name,e);
        skipped.push(f.name+' (upload error)');
      }
    }else{
      skipped.push(f.name+' (no match)');
      console.log('No match for',f.name,'— tried against:',D.roster.map(r=>r.name));
    }
  }
  if(matched)saveNow();
  renderRoster();
  let msg=`Uploaded ${matched} photo${matched!==1?'s':''}`;
  if(skipped.length)msg+=`\nCouldn't match: ${skipped.join(', ')}`;
  alert(msg);
}

function renderRoster(){
  const grid=document.getElementById('rosterGrid');
  const admin=isAdmin();
  const hint=document.getElementById('rosterHint');
  if(hint) hint.textContent='The '+activeSeason+' New York Groove.';
  let html='';

  // If admin is viewing roster, enter edit context
  if(admin && activeTab==='roster') enterEditContext('roster');

  D.roster.forEach((r,i)=>{
    const expanded=expandedRoster[r.id];
    const photoHtml=r.photo?`<img src="${r.photo}">`:`<span class="material-symbols-outlined" style="font-size:28px">person</span>`;
    const bigPhotoHtml=r.photo?`<img src="${r.photo}">`:`<span class="material-symbols-outlined">person</span>`;

    if(admin){
      // ─── ADMIN: Collapsed card (compact edit) ───
      if(!expanded){
        html+=`<div class="roster-card"><div class="roster-card-top">`;
        html+=`<div class="roster-avatar">${photoHtml}</div>`;
        html+=`<input class="rn-input" value="${esc(r.name)}" placeholder="Name" oninput="D.roster[${i}].name=this.value">`;
        html+=`<div style="display:flex;gap:4px;justify-content:center;margin-top:4px"><input class="rnum-input" value="${esc(r.number?'#'+r.number:'')}" placeholder="#00" oninput="D.roster[${i}].number=this.value.replace('#','')"><input class="rpos-input" value="${esc(r.position||'')}" placeholder="POS" oninput="D.roster[${i}].position=this.value"></div>`;
        html+=`</div>`;
        html+=`<div class="roster-card-expand"><button onclick="expandedRoster['${r.id}']=true;renderRoster()"><span class="material-symbols-outlined" style="font-size:16px">expand_more</span>Edit details</button></div>`;
        html+=`</div>`;
      } else {
        // ─── ADMIN: Expanded card (full edit) ───
        html+=`<div class="player-detail">`;
        html+=`<div class="pd-header">`;
        // Photo with upload overlay
        html+=`<div class="pd-photo" onclick="document.getElementById('photoUp-${i}').click()">`;
        html+=bigPhotoHtml;
        html+=`<div class="pd-photo-upload"><span class="material-symbols-outlined">photo_camera</span></div>`;
        html+=`<input type="file" id="photoUp-${i}" accept="image/*" style="display:none" onchange="handleRosterPhoto(${i},this.files)">`;
        html+=`</div>`;
        // Info fields
        html+=`<div class="pd-info">`;
        html+=`<div class="pd-edit-row"><div class="pd-edit-field-wide"><label>Name</label><input value="${esc(r.name)}" placeholder="Full name" oninput="D.roster[${i}].name=this.value"></div><div class="pd-edit-field" style="max-width:70px"><label>#</label><input value="${esc(r.number||'')}" placeholder="00" oninput="D.roster[${i}].number=this.value.replace('#','')"></div><div class="pd-edit-field" style="max-width:90px"><label>Pos</label><input value="${esc(r.position||'')}" placeholder="C/1B" oninput="D.roster[${i}].position=this.value" style="text-transform:uppercase"></div></div>`;
        html+=`<div class="pd-edit-row"><div class="pd-edit-field"><label>Throws</label><input value="${esc(r.throws||'')}" placeholder="R / L / S" oninput="D.roster[${i}].throws=this.value"></div><div class="pd-edit-field"><label>Bats</label><input value="${esc(r.bats||'')}" placeholder="R / L / S" oninput="D.roster[${i}].bats=this.value"></div><div class="pd-edit-field"><label>Height</label><input value="${esc(r.height||'')}" placeholder="6'2&quot;" oninput="D.roster[${i}].height=this.value"></div><div class="pd-edit-field"><label>Hometown</label><input value="${esc(r.hometown||'')}" placeholder="City, ST" oninput="D.roster[${i}].hometown=this.value"></div></div>`;
        html+=`<div class="pd-edit-row"><div style="flex:1"><label>Walkup Song (Spotify link)</label><input value="${esc(r.walkupSong||'')}" placeholder="https://open.spotify.com/track/..." oninput="D.roster[${i}].walkupSong=this.value"></div></div>`;
        html+=`<div class="pd-edit-row"><div style="flex:1"><label>Aliases (comma-separated nicknames for CSV matching)</label><input value="${esc((r.aliases||[]).join(', '))}" placeholder="e.g. Ruvo, E.R." oninput="D.roster[${i}].aliases=this.value.split(',').map(s=>s.trim()).filter(Boolean)"></div></div>`;
        html+=`<div class="pd-edit-row"><div style="flex:1"><label>Player Email (links sign-in to this card)</label><input value="${esc(r.email||'')}" placeholder="player@gmail.com" oninput="D.roster[${i}].email=this.value"></div></div>`;
        html+=`</div></div>`;
        // Bio
        html+=`<div style="padding:0 24px 16px"><label style="display:block;font-size:10px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Bio</label><textarea style="width:100%;padding:10px 12px;border:1px solid var(--brd);border-radius:6px;font-size:14px;line-height:1.6;resize:vertical;min-height:80px;font-family:'Sen',sans-serif" oninput="D.roster[${i}].bio=this.value">${esc(r.bio||'')}</textarea></div>`;
        // Walkup song preview
        if(spotifyTrackId(r.walkupSong)){
          html+=`<div class="pd-song"><div class="pd-song-label">Walkup Song</div>${spotifyEmbed(r.walkupSong)}</div>`;
        }
        // Stats
        const stats=getPlayerStatsByName(r.name);
        if(stats){
          const es=enabledStats();
          html+=`<div class="pd-stats"><div class="pd-stats-label">Season Stats</div><div class="table-wrap"><table><thead><tr><th>GP</th>`;
          es.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});
          html+=`<th>AVG</th></tr></thead><tbody><tr><td>${stats.gp}</td>`;
          es.forEach(s=>{html+=`<td>${stats[s.id]||0}</td>`});
          html+=`<td class="calc-cell">${avg3(stats.h||0,stats.ab||0)}</td></tr></tbody></table></div></div>`;
        }
        // Actions
        html+=`<div class="pd-actions"><button class="rm-btn" onclick="delRosterPlayer(${i},this)">Remove player</button><button style="border:none;background:transparent;color:var(--mut);font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:3px" onclick="expandedRoster['${r.id}']=false;renderRoster()"><span class="material-symbols-outlined" style="font-size:16px">expand_less</span>Collapse</button></div>`;
        html+=`</div>`;
      }
    } else {
      // ─── VISITOR: Collapsed card (read-only) ───
      if(!expanded){
        html+=`<div class="roster-card"><div class="roster-card-top"><div class="roster-avatar">${photoHtml}</div><div class="rname">${esc(r.name)||'—'}</div>`;
        if(r.number)html+=`<div class="rnumber">#${esc(r.number)}</div>`;
        if(r.position)html+=`<div class="rposition">${esc(r.position)}</div>`;
        html+=`</div>`;
        html+=`<div class="roster-card-expand"><button onclick="expandedRoster['${r.id}']=true;renderRoster()"><span class="material-symbols-outlined" style="font-size:16px">expand_more</span>Read more</button></div>`;
        html+=`</div>`;
      } else {
        // ─── VISITOR: Expanded baseball card ───
        const isOwn=ownRosterIndex()===i;
        html+=`<div class="player-detail">`;
        html+=`<div class="pd-header">`;
        if(isOwn){
          html+=`<div class="pd-photo" onclick="document.getElementById('photoUp-${i}').click()">`;
          html+=bigPhotoHtml;
          html+=`<div class="pd-photo-upload"><span class="material-symbols-outlined">photo_camera</span></div>`;
          html+=`<input type="file" id="photoUp-${i}" accept="image/*" style="display:none" onchange="handleRosterPhoto(${i},this.files)">`;
          html+=`</div>`;
        }else{
          html+=`<div class="pd-photo">${bigPhotoHtml}</div>`;
        }
        html+=`<div class="pd-info">`;
        html+=`<div class="pd-name-row"><span class="pd-name">${esc(r.name)}</span>`;
        if(r.position)html+=`<span class="pd-pos">${esc(r.position)}</span>`;
        html+=`</div>`;
        if(isOwn){
          html+=`<div class="pd-edit-row"><div class="pd-edit-field"><label>Throws</label><input value="${esc(r.throws||'')}" placeholder="R / L / S" oninput="D.roster[${i}].throws=this.value"></div><div class="pd-edit-field"><label>Bats</label><input value="${esc(r.bats||'')}" placeholder="R / L / S" oninput="D.roster[${i}].bats=this.value"></div><div class="pd-edit-field"><label>Height</label><input value="${esc(r.height||'')}" placeholder="6'2&quot;" oninput="D.roster[${i}].height=this.value"></div><div class="pd-edit-field"><label>Hometown</label><input value="${esc(r.hometown||'')}" placeholder="City, ST" oninput="D.roster[${i}].hometown=this.value"></div></div>`;
          html+=`<div class="pd-edit-row"><div style="flex:1"><label>Walkup Song (Spotify link)</label><input value="${esc(r.walkupSong||'')}" placeholder="https://open.spotify.com/track/..." oninput="D.roster[${i}].walkupSong=this.value"></div></div>`;
        }else{
          const vitals=[];
          if(r.throws)vitals.push('Throws: '+esc(r.throws));
          if(r.bats)vitals.push('Bats: '+esc(r.bats));
          if(r.height)vitals.push(esc(r.height));
          if(r.hometown)vitals.push(esc(r.hometown));
          if(r.number)vitals.push('#'+esc(r.number));
          if(vitals.length){
            html+=`<div class="pd-vitals">${vitals.map(v=>'<span>'+v+'</span>').join('')}</div>`;
          }
        }
        html+=`</div></div>`;
        // Bio
        if(isOwn){
          html+=`<div style="padding:0 24px 16px"><label style="display:block;font-size:10px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Bio</label><textarea style="width:100%;padding:10px 12px;border:1px solid var(--brd);border-radius:6px;font-size:14px;line-height:1.6;resize:vertical;min-height:80px;font-family:'Sen',sans-serif" oninput="D.roster[${i}].bio=this.value">${esc(r.bio||'')}</textarea></div>`;
        }else{
          if(r.bio)html+=`<div class="pd-bio">${esc(r.bio)}</div>`;
        }
        // Walkup song
        if(spotifyTrackId(r.walkupSong)){
          html+=`<div class="pd-song"><div class="pd-song-label">Walkup Song</div>${spotifyEmbed(r.walkupSong)}</div>`;
        }
        // Stats
        const stats=getPlayerStatsByName(r.name);
        if(stats){
          const es=enabledStats();
          html+=`<div class="pd-stats"><div class="pd-stats-label">Season Stats</div><div class="table-wrap"><table><thead><tr><th>GP</th>`;
          es.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});
          html+=`<th>AVG</th></tr></thead><tbody><tr><td>${stats.gp}</td>`;
          es.forEach(s=>{html+=`<td>${stats[s.id]||0}</td>`});
          html+=`<td class="calc-cell">${avg3(stats.h||0,stats.ab||0)}</td></tr></tbody></table></div></div>`;
        }
        // Post backlinks
        const mentions=D.posts.filter(post=>{
          const text=((post.title||'')+' '+(post.body||'')+' '+(post.author||'')).toLowerCase();
          const nameLC=r.name.trim().toLowerCase();
          if(text.includes(nameLC))return true;
          const aliases=(r.aliases||[]).map(a=>a.trim().toLowerCase()).filter(Boolean);
          return aliases.some(a=>text.includes(a));
        });
        if(mentions.length){
          html+=`<div style="padding:0 24px 16px"><div style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Mentioned In</div>`;
          mentions.forEach(post=>{
            const label=post.title||post.type==='recap'?('Game Recap'+(post.opponent?' vs '+esc(post.opponent):'')):(post.type||'Post');
            const date=fmtDateShort(post.date||post.createdAt);
            html+=`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f5f3ed;cursor:pointer;font-size:13px" onclick="activeTab='home';renderAll();setTimeout(()=>{const el=document.querySelector('[data-postid=&quot;${post.id}&quot;]');if(el)el.scrollIntoView({behavior:'smooth',block:'center'})},100)"><span class="material-symbols-outlined" style="font-size:14px;color:var(--acc)">article</span><span style="font-weight:600;color:var(--pri)">${post.title?esc(post.title):esc(label)}</span><span style="color:var(--mut);font-size:11px;margin-left:auto">${date}</span></div>`;
          });
          html+=`</div>`;
        }
        // Own-card save + collapse
        if(isOwn){
          html+=`<div style="padding:12px 24px 16px;display:flex;justify-content:space-between;align-items:center"><button class="save-btn" onclick="saveNow();renderRoster()" style="font-size:12px;padding:7px 18px">Save My Card</button><button style="border:none;background:transparent;color:var(--mut);font-size:11px;font-weight:600;display:flex;align-items:center;gap:3px;cursor:pointer" onclick="expandedRoster['${r.id}']=false;renderRoster()"><span class="material-symbols-outlined" style="font-size:16px">expand_less</span>Show less</button></div>`;
        }else{
          html+=`<div style="padding:8px 24px 16px;display:flex;justify-content:center"><button style="border:none;background:transparent;color:var(--mut);font-size:11px;font-weight:600;display:flex;align-items:center;gap:3px;cursor:pointer" onclick="expandedRoster['${r.id}']=false;renderRoster()"><span class="material-symbols-outlined" style="font-size:16px">expand_less</span>Show less</button></div>`;
        }
        html+=`</div>`;
      }
    }
  });

  // Add player card (admin only)
  if(admin){
    html+=`<div class="roster-card-add" onclick="D.roster.push({id:uid(),name:'',number:'',position:'',bio:'',photo:'',throws:'',bats:'',height:'',hometown:'',walkupSong:'',aliases:[]});renderRoster()"><span class="material-symbols-outlined">person_add</span><span>Add Player</span></div>`;
  }

  grid.innerHTML=html;

  // Admin buttons area
  const adminBtns=document.getElementById('rosterAdminBtns');
  adminBtns.innerHTML='';
}

function getPlayerStatsByName(name){
  if(!name)return null;
  const key=name.trim().toLowerCase();
  const totals=getPlayerTotals();
  return totals.find(p=>p.name.trim().toLowerCase()===key)||null;
}

function delRosterPlayer(i,btn){
  if(btn.dataset.confirm){D.roster.splice(i,1);renderRoster();return}
  btn.dataset.confirm='1';btn.textContent='Click again to confirm';btn.style.color='var(--loss)';btn.style.fontWeight='700';
  setTimeout(()=>{if(btn.isConnected){delete btn.dataset.confirm;btn.textContent='Remove';btn.style.color='';btn.style.fontWeight=''}},3000);
}

function confirmDeleteAllPhotos(btn){
  if(btn.dataset.confirm){
    D.roster.forEach(r=>{ r.photo = '' });
    saveNow();
    renderSettings();
    renderRoster();
    return;
  }
  btn.dataset.confirm='1';
  btn.classList.add('confirm');
  btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px">warning</span>Click again to confirm';
  setTimeout(()=>{
    if(btn.isConnected){
      delete btn.dataset.confirm;
      btn.classList.remove('confirm');
      btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px">delete</span>Delete all photos';
    }
  },3000);
}

/* ═══ COMPOSER ═══ */
function openComposer(){composerType='recap';composerData={title:'',body:'',author:currentUser?currentUser.displayName||'':'',photos:[]};composerGameId=null;editingPostId=null;renderComposer();document.getElementById('composerOverlay').classList.add('open')}
function closeComposer(){document.getElementById('composerOverlay').classList.remove('open');editingPostId=null}

function editPost(postId){
  const post=D.posts.find(p=>p.id===postId);
  if(!post)return;
  editingPostId=postId;
  composerType=post.type||'note';
  composerData={title:post.title||'',body:post.body||'',author:post.author||'',photos:post.photos||[]};
  composerGameId=post.gameId||null;
  renderComposer();
  document.getElementById('composerOverlay').classList.add('open');
  // Auto-resize after overlay is visible so scrollHeight is accurate
  setTimeout(()=>{document.querySelectorAll('#composerInner textarea').forEach(el=>{if(el.value)autoResize(el)})},0);
}

function renderComposer(){
  const isEditing=!!editingPostId;
  const types=[{id:'recap',label:'Game Recap',icon:'scoreboard'},{id:'photo',label:'Photos',icon:'photo_camera'},{id:'dataviz',label:'Data / Stats',icon:'bar_chart'},{id:'note',label:'Note',icon:'edit_note'}];
  let html=`<h2>${isEditing?'Edit Post':'Post Something'}</h2><div class="composer-type-row">`;
  types.forEach(t=>{html+=`<button class="type-btn${composerType===t.id?' active':''}" onclick="composerType='${t.id}';composerGameId=null;renderComposer()"><span class="material-symbols-outlined" style="font-size:16px">${t.icon}</span>${t.label}</button>`});
  html+=`</div>`;
  html+=`<div class="cf"><label>Author</label><input value="${esc(composerData.author)}" placeholder="Your name" oninput="composerData.author=this.value"></div>`;

  if(composerType==='recap'){
    const taken=recapGameIds();
    html+=`<div class="cf"><label>Select a game</label>`;
    if(!D.games.length){html+=`<p style="font-size:13px;color:var(--mut)">No box scores yet. Create games in Box Scores first.</p>`}
    else{
      html+=`<div class="game-picker">`;
      D.games.forEach((g,i)=>{
        const hasCap=taken.has(g.id);const sel=composerGameId===g.id;
        const cls=sel?'selected':hasCap?'taken':'available';
        const lbl=g.opponent?`vs ${esc(g.opponent)}`:`Game ${i+1}`;
        const sub=g.date?fmtDateShort(g.date):'';
        if(!hasCap){
          html+=`<div class="gp-cell ${cls}" onclick="composerGameId='${g.id}';renderComposer()"><div style="font-size:12px;font-weight:700">${lbl}</div>${sub?`<div class="gp-label">${sub}</div>`:''}</div>`;
        }else{
          html+=`<div class="gp-cell ${cls}"><div style="font-size:12px">✓ ${lbl}</div>${sub?`<div class="gp-label">${sub}</div>`:''}</div>`;
        }
      });
      html+=`</div>`;
    }
    html+=`</div>`;
    html+=`<div class="cf"><label>Title</label><input value="${esc(composerData.title)}" placeholder="e.g. A Slugfest in the Rain" oninput="composerData.title=this.value"></div>`;
    html+=`<div class="cf"><label>Write-up</label><textarea placeholder="The full story of this game — etched into history..." oninput="composerData.body=this.value;autoResize(this)" style="min-height:200px">${esc(composerData.body)}</textarea><span style="font-size:10px;color:var(--mut);margin-top:2px">Use **bold** and *italic* for formatting</span></div>`;
  }else if(composerType==='photo'){
    html+=`<div class="cf"><label>Caption</label><input value="${esc(composerData.title)}" placeholder="What's in the photo?" oninput="composerData.title=this.value"></div>`;
    html+=`<div class="cf"><label>Photos</label><div class="photo-drop" onclick="document.getElementById('photoInput').click()">Click to upload photos</div><input type="file" id="photoInput" accept="image/*" multiple style="display:none" onchange="handlePhotos(this.files)"><div class="photo-preview" id="photoPreview"></div></div>`;
    html+=`<div class="cf"><label>Description</label><textarea placeholder="Story behind these photos..." oninput="composerData.body=this.value;autoResize(this)" style="min-height:160px">${esc(composerData.body)}</textarea></div>`;
  }else if(composerType==='dataviz'){
    html+=`<div class="cf"><label>Title</label><input value="${esc(composerData.title)}" placeholder="e.g. RBI Trends Through Game 10" oninput="composerData.title=this.value"></div>`;
    html+=`<div class="cf"><label>Analysis</label><textarea placeholder="What does the data show?" oninput="composerData.body=this.value;autoResize(this)" style="min-height:160px">${esc(composerData.body)}</textarea></div>`;
    html+=`<div class="cf"><label>Image (optional)</label><div class="photo-drop" onclick="document.getElementById('photoInput').click()">Upload chart / visualization</div><input type="file" id="photoInput" accept="image/*" multiple style="display:none" onchange="handlePhotos(this.files)"><div class="photo-preview" id="photoPreview"></div></div>`;
  }else{
    html+=`<div class="cf"><label>Title (optional)</label><input value="${esc(composerData.title)}" placeholder="Quick update" oninput="composerData.title=this.value"></div>`;
    html+=`<div class="cf"><label>Note</label><textarea placeholder="What's on your mind, Groove member?" oninput="composerData.body=this.value;autoResize(this)" style="min-height:200px">${esc(composerData.body)}</textarea><span style="font-size:10px;color:var(--mut);margin-top:2px">Use **bold** and *italic* for formatting</span></div>`;
  }
  html+=`<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px"><button class="cancel-btn" onclick="closeComposer()">Cancel</button><button class="save-btn" onclick="publishPost()">${isEditing?'Update Post':'Save & Publish'}</button></div>`;
  document.getElementById('composerInner').innerHTML=html;
  if(composerData.photos&&composerData.photos.length){const pp=document.getElementById('photoPreview');if(pp)pp.innerHTML=composerData.photos.map(p=>p==='uploading'?`<div style="width:80px;height:80px;border-radius:6px;background:var(--brd);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--mut)">Uploading…</div>`:`<img src="${p}">`).join('')}
  // Auto-expand pre-filled textareas (e.g. editing an existing post)
  document.querySelectorAll('#composerInner textarea').forEach(el=>{if(el.value)autoResize(el)});
}
function handlePhotos(files){
  Array.from(files).forEach(async f=>{
    const idx=composerData.photos.length;
    composerData.photos.push('uploading');
    pendingUploads++;
    updatePublishBtn();
    renderComposer();
    const blob=await resizeImage(f,1200);
    const url=await uploadPhoto(blob,f.name||'photo.jpg');
    composerData.photos[idx]=url;
    pendingUploads--;
    updatePublishBtn();
    renderComposer();
  });
}
function updatePublishBtn(){
  const btn=document.querySelector('#composerInner .save-btn');
  if(btn){btn.disabled=pendingUploads>0;btn.textContent=pendingUploads>0?'Uploading...':'Save & Publish'}
}

function publishPost(){
  // Filter out any still-uploading placeholders
  composerData.photos=(composerData.photos||[]).filter(p=>p&&p!=='uploading');
  let opponent='',runsFor='',runsAgainst='',gameDate='',gameLocation='';
  if(composerType==='recap'&&composerGameId){
    const g=D.games.find(x=>x.id===composerGameId);
    if(g){opponent=g.opponent||'';runsFor=g.runsFor||'';runsAgainst=g.runsAgainst||'';gameDate=g.date||'';gameLocation=g.location||''}
  }

  if(editingPostId){
    // Update existing post
    const post=D.posts.find(p=>p.id===editingPostId);
    if(post){
      post.type=composerType;
      post.title=composerData.title||'';
      post.body=composerData.body||'';
      post.author=composerData.author||post.author;
      post.photos=composerData.photos||[];
      post.gameId=composerGameId||'';
      if(composerType==='recap'){
        post.opponent=opponent;post.runsFor=runsFor;post.runsAgainst=runsAgainst;
        post.location=gameLocation;
        if(gameDate)post.date=gameDate;
      }
    }
    editingPostId=null;
  } else {
    // Create new post
    const post={id:uid(),type:composerType,title:composerData.title||'',body:composerData.body||'',
      author:composerData.author||'Anonymous Groover',
      date:composerType==='recap'&&gameDate?gameDate:new Date().toISOString().slice(0,10),
      createdAt:Date.now(),photos:composerData.photos||[],
      opponent,runsFor,runsAgainst,location:gameLocation,gameId:composerGameId||'',
      comments:[]};
    D.posts.unshift(post);
  }
  saveNow();closeComposer();activeTab='home';renderAll();
}

/* ═══ LIGHTBOX ═══ */
let lbPhotos=[],lbIdx=0;
function openLightbox(photos,idx){
  lbPhotos=photos;lbIdx=idx;
  const el=document.getElementById('lightbox');
  el.classList.add('open');
  renderLightbox();
}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');lbPhotos=[]}
function lbNav(dir){lbIdx=(lbIdx+dir+lbPhotos.length)%lbPhotos.length;renderLightbox()}
function renderLightbox(){
  const img=document.getElementById('lbImg');
  img.src=lbPhotos[lbIdx];
  document.getElementById('lbCounter').textContent=lbPhotos.length>1?(lbIdx+1)+' / '+lbPhotos.length:'';
  document.getElementById('lbPrev').style.display=lbPhotos.length>1?'':'none';
  document.getElementById('lbNext').style.display=lbPhotos.length>1?'':'none';
}
document.addEventListener('keydown',e=>{
  if(!document.getElementById('lightbox').classList.contains('open'))return;
  if(e.key==='Escape')closeLightbox();
  if(e.key==='ArrowLeft')lbNav(-1);
  if(e.key==='ArrowRight')lbNav(1);
});
// Delegated click for post photos
document.addEventListener('click',e=>{
  const img=e.target.closest('.post-photos img[data-phi]');
  if(!img)return;
  const wrap=img.closest('.post-photos');
  const photos=JSON.parse(wrap.dataset.photos);
  openLightbox(photos,parseInt(img.dataset.phi));
});
// Touch swipe
(function(){let sx=0;const lb=document.getElementById('lightbox');
  lb.addEventListener('touchstart',e=>{sx=e.touches[0].clientX},{passive:true});
  lb.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>50){dx<0?lbNav(1):lbNav(-1)}},{passive:true});
})();

/* ═══ FEED ═══ */
function renderFeed(){
  const area=document.getElementById('feedArea');

  // 2025: static season view
  if(activeSeason==='2025'){
    let html='<div class="post" style="padding:28px 24px;text-align:center">';
    html+='<div style="font-size:15px;color:var(--pri);font-weight:700;margin-bottom:6px">The 2025 Season</div>';
    html+='<p style="font-size:14px;color:var(--mut);line-height:1.7;max-width:480px;margin:0 auto 24px">We regretfully did not keep a record of the fun. That will change this year.</p>';
    html+='</div>';
    // Game results
    SEASON_2025.forEach(g=>{
      if(!g.result && !g.score) return; // skip unplayed/future
      const isW=g.result==='W',isL=g.result==='L',isRain=g.result==='Rainout';
      const rc=isW?'win':isL?'loss':isRain?'tie':'';
      const atVs=g.type==='home'?'vs':'at';
      const rl=isRain?'RAINOUT':isW?'WIN':isL?'LOSS':'';
      let scoreDisplay='';
      if(g.score){const parts=g.score.split('-');scoreDisplay=parts[0]+' – '+parts[1]}
      html+=`<div class="post" style="padding:0;overflow:hidden">`;
      html+=`<div class="recap-banner" style="border-radius:var(--radius)"><div class="rb-grid" style="grid-template-columns:auto 1fr">`;
      if(scoreDisplay){
        html+=`<div class="rb-score-block"><div class="rb-result ${rc}">${rl} ${atVs} ${esc(g.opponent)}</div><div class="rb-score">${scoreDisplay}</div></div>`;
      } else {
        html+=`<div class="rb-score-block"><div class="rb-result ${rc}">${rl}</div><div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.7)">${atVs} ${esc(g.opponent)}</div></div>`;
      }
      html+=`<div class="rb-info"><span class="rb-opponent">${atVs} ${esc(g.opponent)}</span><span class="rb-info-right"><span class="rb-date">${esc(g.date)}</span></span></div>`;
      html+=`</div></div></div>`;
    });
    area.innerHTML=html;
    return;
  }

  if(!D.posts.length){area.innerHTML='<div class="empty"><div class="empty-text" style="font-size:18px;color:#bbb;margin-top:20px">Nothing here yet.</div><p style="color:#ccc;font-size:13px;margin-top:6px">Hit the button to make history.</p></div>';return}
  const admin=isAdmin();
  let html='';
  D.posts.forEach((p,i)=>{
    html+=`<div class="post" data-postid="${p.id}">`;
    if(p.type==='recap'&&p.runsFor){
      const w=n(p.runsFor)>n(p.runsAgainst),l=n(p.runsFor)<n(p.runsAgainst);
      const rc=w?'win':l?'loss':'tie';
      const rl=w?'WIN':l?'LOSS':'TIE';
      const loc=resolveLocation(p);
      const gdate=fmtGameDate(p.date);
      const isHome=loc&&(/inwood/i.test(loc)||/randall/i.test(loc));
      const atVs=isHome?'vs':'at';
      // Resolve game for weather + stats
      const game=p.gameId?D.games.find(x=>x.id===p.gameId):null;
      const weather=game&&game.weather?game.weather:'';
      // Compute key stats from box score
      let statsHtml='';
      const dash=v=>v?v:'—';
      if(game&&game.players&&game.players.length){
        const pl=game.players;
        const anyH=pl.some(x=>x.h!=null&&x.h!=='');
        const anyBB=pl.some(x=>x.bb!=null&&x.bb!=='');
        const anyK=pl.some(x=>x.so!=null&&x.so!=='');
        const totalH=anyH?pl.reduce((s,x)=>s+n(x.h),0):null;
        const totalHR=pl.reduce((s,x)=>s+n(x.hr),0);
        const totalBB=anyBB?pl.reduce((s,x)=>s+n(x.bb),0):null;
        const totalK=anyK?pl.reduce((s,x)=>s+n(x.so),0):null;
        statsHtml+=`<span class="rb-stat-section">BAT</span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalH)}</span><span class="rb-stat-label">H</span></span>`;
        if(totalHR)statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${totalHR}</span><span class="rb-stat-label">HR</span></span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalBB)}</span><span class="rb-stat-label">BB</span></span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalK)}</span><span class="rb-stat-label">K</span></span>`;
      }
      if(game&&game.pitching&&game.pitching.length){
        const pp=game.pitching;
        const anyIP=pp.some(x=>x.ip!=null&&x.ip!=='');
        const anyPH=pp.some(x=>x.ph!=null&&x.ph!=='');
        const anyPBB=pp.some(x=>x.pbb!=null&&x.pbb!=='');
        const anyPK=pp.some(x=>x.pk!=null&&x.pk!=='');
        const totalIP=anyIP?pp.reduce((s,x)=>s+parseFloat(x.ip||0),0):null;
        const totalPH=anyPH?pp.reduce((s,x)=>s+n(x.ph),0):null;
        const totalPBB=anyPBB?pp.reduce((s,x)=>s+n(x.pbb),0):null;
        const totalPK=anyPK?pp.reduce((s,x)=>s+n(x.pk),0):null;
        statsHtml+=`<span class="rb-stat-sep">|</span><span class="rb-stat-section">ARM</span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${totalIP!=null?totalIP:'—'}</span><span class="rb-stat-label">IP</span></span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalPH)}</span><span class="rb-stat-label">H</span></span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalPBB)}</span><span class="rb-stat-label">BB</span></span>`;
        statsHtml+=`<span class="rb-stat"><span class="rb-stat-val">${dash(totalPK)}</span><span class="rb-stat-label">K</span></span>`;
      }
      // Info row: stats left, location · weather · date right
      let infoHtml=statsHtml?`<span class="rb-stats-group">${statsHtml}</span>`:`<span class="rb-opponent">${atVs} ${esc(p.opponent||'TBD')}</span>`;
      // Line score (full-width bottom row, built separately)
      const lsAway=game&&game.lineScoreAway?game.lineScoreAway:'';
      const lsHome=game&&game.lineScoreHome?game.lineScoreHome:'';
      let lineScoreHtml='';
      if(lsAway||lsHome){
        const awayInns=(lsAway||'').split(',').map(s=>s.trim()).filter(Boolean);
        const homeInns=(lsHome||'').split(',').map(s=>s.trim()).filter(Boolean);
        const numInnings=Math.max(awayInns.length,homeInns.length);
        const isHome=loc&&(/inwood/i.test(loc)||/randall/i.test(loc));
        const topFull=isHome?esc(p.opponent||'AWAY'):'Groove';
        const botFull=isHome?'Groove':esc(p.opponent||'HOME');
        const topShort=isHome?esc((p.opponent||'AWY').slice(0,3).toUpperCase()):'NYG';
        const botShort=isHome?'NYG':esc((p.opponent||'HME').slice(0,3).toUpperCase());
        const teamCell=(full,short)=>`<td class="rb-ls-team"><span class="rb-ls-full">${full}</span><span class="rb-ls-short">${short}</span></td>`;
        lineScoreHtml+=`<div class="rb-linescore"><table class="rb-ls-table"><thead><tr><th></th>`;
        for(let i=0;i<numInnings;i++)lineScoreHtml+=`<th>${i+1}</th>`;
        lineScoreHtml+=`<th class="rb-ls-total">R</th>`;
        lineScoreHtml+=`</tr></thead><tbody>`;
        lineScoreHtml+=`<tr>${teamCell(topFull,topShort)}`;
        for(let i=0;i<numInnings;i++)lineScoreHtml+=`<td>${awayInns[i]||'—'}</td>`;
        lineScoreHtml+=`<td class="rb-ls-total">${awayInns.reduce((s,v)=>s+parseInt(v||0),0)}</td>`;
        lineScoreHtml+=`</tr><tr>${teamCell(botFull,botShort)}`;
        for(let i=0;i<numInnings;i++)lineScoreHtml+=`<td>${homeInns[i]||'—'}</td>`;
        lineScoreHtml+=`<td class="rb-ls-total">${homeInns.reduce((s,v)=>s+parseInt(v||0),0)}</td>`;
        lineScoreHtml+=`</tr></tbody></table></div>`;
      }
      infoHtml+=`<span class="rb-info-right">`;
      if(loc)infoHtml+=`<span class="rb-location"><span class="material-symbols-outlined">location_on</span><a href="${mapsUrl(loc)}" target="_blank" rel="noopener">${esc(loc)}</a></span>`;
      if(weather){if(loc)infoHtml+=`<span class="rb-sep">·</span>`;infoHtml+=`<span class="rb-weather"><span class="material-symbols-outlined">thermostat</span>${esc(weather)}</span>`}
      if(loc||weather)infoHtml+=`<span class="rb-sep">·</span>`;
      const gameTime=game&&game.time?fmtTime(game.time):'';
      infoHtml+=`<span class="rb-date">${gdate}${gameTime?' · '+gameTime:''}</span>`;
      infoHtml+=`<span class="rb-author-mobile">Recap by ${playerChip(p.author)}</span>`;
      infoHtml+=`</span>`;
      // Details row: author left, lineup right
      let detailsHtml=`<span class="rb-author">Recap by ${playerChip(p.author)}</span>`;
      detailsHtml+=`<span class="rb-detail-spacer"></span>`;

      // Lineup photos — inline in details row, with hover cards
      if(game&&game.players&&game.players.length){
        detailsHtml+=`<span class="rb-lineup">`;
        game.players.forEach(gp=>{
          const rEntry=gp.rosterId?D.roster.find(r=>r.id===gp.rosterId):D.roster.find(r=>r.name&&r.name.trim().toLowerCase()===(gp.name||'').trim().toLowerCase());
          const photo=rEntry&&rEntry.photo?rEntry.photo:'';
          const isCutout=photo&&/\.png/i.test(photo);
          const hoverCard=rEntry?chipHoverHtml({name:rEntry.name,number:rEntry.number||'',photo:rEntry.photo||'',position:rEntry.position||'',walkupSong:rEntry.walkupSong||''}):'';
          let imgHtml;
          if(photo&&isCutout){
            imgHtml=`<img class="rb-lineup-photo-cutout" src="${photo}" alt="${esc(gp.name||'')}">`;
          }else if(photo){
            imgHtml=`<img class="rb-lineup-photo-circle" src="${photo}" alt="${esc(gp.name||'')}">`;
          }else{
            imgHtml=`<span class="rb-lineup-placeholder"><span class="material-symbols-outlined">person</span></span>`;
          }
          detailsHtml+=`<span class="rb-lineup-player player-chip rb-lineup-chip">${imgHtml}${hoverCard}</span>`;
        });
        detailsHtml+=`</span>`;
      }

      html+=`<div class="recap-banner"><div class="rb-grid">`
        +`<div class="rb-score-block"><div class="rb-result ${rc}">${rl} ${atVs} ${esc(p.opponent||'')}</div><div class="rb-score">${esc(p.runsFor)} – ${esc(p.runsAgainst)}</div></div>`
        +`<div class="rb-info">${infoHtml}</div>`
        +`<div class="rb-details">${detailsHtml}</div>`
        +(lineScoreHtml?`<div class="rb-linescore-row">${lineScoreHtml}</div>`:'')
        +`</div></div>`;
      if(p.title)html+=`<div class="post-title">${chipifyText(p.title)}</div>`;
    }else{
      html+=`<div class="post-header"><div><div class="post-author">${playerChip(p.author)}</div><div class="post-date">${fmtDate(p.createdAt||p.date)}</div></div></div>`;
      if(p.title)html+=`<div class="post-title">${chipifyText(p.title)}</div>`;
    }
    if(p.body)html+=`<div class="post-body">${chipifyText(p.body)}</div>`;
    if(p.photos&&p.photos.length){html+=`<div class="post-photos" data-photos='${JSON.stringify(p.photos).replace(/'/g,"&#39;")}'>`;p.photos.forEach((ph,phi)=>{html+=`<img src="${ph}" style="max-height:360px;cursor:pointer" data-phi="${phi}">`});html+=`</div>`}
    if(p.type==='recap'&&p.gameId){html+=`<div style="padding:4px 24px 12px"><button class="post-boxscore-btn" onclick="activeGame='${p.gameId}';activeTab='boxscores';renderAll()">See Box Score</button></div>`}
    const commOpen=openComments[p.id];
    const cc=p.comments||[];
    html+=`<div class="comments-section">`;
    html+=`<button class="comments-toggle" onclick="openComments['${p.id}']=!openComments['${p.id}'];renderFeed()"><span class="material-symbols-outlined" style="font-size:16px">${commOpen?'expand_less':'chat_bubble'}</span>${cc.length?cc.length+' comment'+(cc.length>1?'s':''):'Add a comment'}${commOpen?' — hide':''}</button>`;
    if(commOpen){
      html+=`<div class="comments-list">`;
      cc.forEach((c,ci)=>{
        html+=`<div class="comment"><div><span class="comment-author">${playerChip(c.author)}</span><span class="comment-date">${fmtDate(c.createdAt)}</span></div><div class="comment-text">${chipifyText(c.text)}</div></div>`;
      });
      html+=`</div>`;
      if(isSignedIn()){html+=`<div class="comment-form"><input id="cmt-${p.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')addComment('${p.id}')"><button onclick="addComment('${p.id}')">Post</button></div>`}
      else{html+=`<div style="font-size:11px;color:var(--mut);margin-top:6px">Sign in to comment</div>`}
    }
    html+=`</div>`;
    html+=`<div class="post-footer"><div></div>`;
    if(admin){html+=`<div style="display:flex;gap:8px;align-items:center">${i>0?`<button class="del-btn" onclick="movePost(${i},-1)" title="Move up"><span class="material-symbols-outlined" style="font-size:16px">arrow_upward</span></button>`:''}${i<D.posts.length-1?`<button class="del-btn" onclick="movePost(${i},1)" title="Move down"><span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span></button>`:''}<button class="del-btn" onclick="editPost('${p.id}')"><span class="material-symbols-outlined" style="font-size:16px">edit</span>Edit</button><button class="del-btn" id="del-${p.id}" onclick="delPost(${i},this)"><span class="material-symbols-outlined" style="font-size:16px">delete</span>Delete</button></div>`}
    html+=`</div>`;
    html+=`</div>`;
  });
  area.innerHTML=html;
}

function addComment(postId){
  const input=document.getElementById('cmt-'+postId);if(!input)return;
  const text=input.value.trim();if(!text)return;
  const post=D.posts.find(p=>p.id===postId);if(!post)return;
  if(!post.comments)post.comments=[];
  post.comments.push({id:uid(),author:currentUser?currentUser.displayName||'Groove Member':'Groove Member',text,createdAt:Date.now()});
  saveNow();renderFeed();
}

function movePost(i,dir){const j=i+dir;if(j<0||j>=D.posts.length)return;[D.posts[i],D.posts[j]]=[D.posts[j],D.posts[i]];saveNow();renderFeed()}
function delPost(i,btn){
  if(btn.classList.contains('confirm')){D.posts.splice(i,1);saveNow();renderFeed();return}
  btn.classList.add('confirm');btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px">warning</span>Click again to delete';
  setTimeout(()=>{if(btn.isConnected){btn.classList.remove('confirm');btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px">delete</span>Delete'}},3000);
}

function heroClick(){
  if(!isAdmin()){return}
  openComposer();
}

let _teaserPlayed = false;

function renderHome(){
  document.getElementById('headerTeam').textContent='Welcome to GrooveHub';
  // Apply season body class for color scheme
  SEASONS.forEach(y=>document.body.classList.remove('season-'+y));
  document.body.classList.add('season-'+activeSeason);

  // Teaser banner — billboard on 2024, page header on 2026
  const teaser = document.getElementById('teaserBanner');
  if(teaser){
    teaser.classList.add('active');
    // Banner is the same size on both seasons for smooth transitions

    const titleEl = document.getElementById('teaserTitle');

    if(titleEl) titleEl.textContent = 'GrooveHub ' + activeSeason;

    const subText = activeSeason==='2026' ? 'New season begins April 11'
      : activeSeason==='2025' ? '11–7 · The Lost Season'
      : 'The inaugural season';
    const subEl = document.getElementById('teaserSub');
    if(subEl) subEl.textContent = subText;
    const colTitle = document.getElementById('teaserColTitle');
    if(colTitle) colTitle.textContent = 'GrooveHub ' + activeSeason;
    const colSub = document.getElementById('teaserColSub');
    if(colSub) colSub.textContent = subText;

    // Season switcher state — update all toggle buttons
    teaser.querySelectorAll('.ts-btn').forEach(b=>{
      const is24 = b.classList.contains('ts-btn-full-24') || b.classList.contains('ts-btn-col-24');
      const is25 = b.classList.contains('ts-btn-full-25') || b.classList.contains('ts-btn-col-25');
      const is26 = b.classList.contains('ts-btn-full-26') || b.classList.contains('ts-btn-col-26');
      b.classList.toggle('active', (is24 && activeSeason==='2024') || (is25 && activeSeason==='2025') || (is26 && activeSeason==='2026'));
    });

    if(!_teaserPlayed){
      _teaserPlayed = true;
      teaser.classList.remove('animate');
      teaser.classList.remove('animate-done');
      requestAnimationFrame(()=>{
        teaser.classList.add('animate');
        // After intro animation, lock opacity so season switches don't re-fade
        setTimeout(()=>{ teaser.classList.add('animate-done'); }, 600);
      });
    } else {
      teaser.classList.add('animate-done');
    }
  }

  // Showcase badge for 2024
  const badge = document.getElementById('showcaseBadge');
  if(badge){
    if(activeSeason==='2024') badge.classList.add('active');
    else badge.classList.remove('active');
  }

  // 2025: force home tab, hide post button
  if(activeSeason==='2025') activeTab='home';

  // Header always visible — banner is consistent across seasons

  renderRecord();
  const btn=document.getElementById('heroBtn');
  if(btn){
    if(isAdmin() && activeSeason!=='2025'){
      btn.className='hero-btn';
      btn.textContent='POST SOMETHING';
      btn.style.display='';
    }else{
      btn.style.display='none';
    }
  }
  renderFeed();
  renderAuthBar();
  const ft=document.getElementById('siteFooter');
  if(ft){
    let fhtml='NY Groove · '+activeSeason;
    if(activeSeason==='2024')fhtml+=` · <a href="https://docs.google.com/spreadsheets/d/1vFn1eYuYG4SQ_C8OQ-yOL_Nk2iubau-TU45tNtDggeQ/edit?usp=sharing" target="_blank" rel="noopener" style="color:var(--mut);text-decoration:underline;font-size:11px" id="sheetLink">See original StatHub 2024</a>`;
    if(activeSeason==='2025')fhtml+=' · The Lost Season';
    ft.innerHTML=fhtml;
  }
}

/* ═══ BOX SCORES ═══ */
function addGame(){const g={id:uid(),date:'',time:'',opponent:'',location:'',runsFor:'',runsAgainst:'',lineScoreAway:'',lineScoreHome:'',weather:'',notes:'',players:D.roster.map(r=>({id:uid(),name:r.name,rosterId:r.id}))};D.games.push(g);activeGame=g.id;activeTab='boxscores';renderAll()}
function renderBoxScores(){
  const admin=isAdmin();
  // Admin buttons area (clear — new game is in the tab row now)
  const adminBtns=document.getElementById('boxAdminBtns');
  adminBtns.innerHTML='';

  // Sort games by date
  D.games.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
  // Game tabs + new game chip
  const gt=document.getElementById('gameTabs');gt.innerHTML='';
  D.games.forEach((g,i)=>{const b=document.createElement('button');b.className='game-tab'+(activeGame===g.id?' active':'');b.textContent=g.date?fmtDateShort(g.date):`Game ${i+1}`;b.onclick=()=>{activeGame=g.id;renderBoxScores()};gt.appendChild(b)});
  if(admin){const ab=document.createElement('button');ab.className='game-tab-add';ab.innerHTML='<span class="material-symbols-outlined" style="font-size:14px">add</span>New Game';ab.onclick=addGame;gt.appendChild(ab)}

  const area=document.getElementById('boxScoreArea');
  if(!activeGame||!D.games.find(g=>g.id===activeGame)){area.innerHTML=D.games.length?'<div class="empty"><div class="empty-text">Select a game above.</div></div>':'<div class="empty"><div class="empty-text">No games yet.</div></div>';return}
  const g=D.games.find(x=>x.id===activeGame);const gi=D.games.indexOf(g);const es=enabledStats();

  if(admin){
    // Enter edit context for box scores
    if(activeTab==='boxscores' && activeGame) enterEditContext('boxscore');
    let html=`<div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px"><h3 style="font-size:18px;font-weight:900">Game ${gi+1}${g.date?' — '+fmtDateShort(g.date):''}</h3><div style="display:flex;gap:6px"><button class="btn btn-sm btn-danger" id="delgame-${gi}" onclick="delGame(${gi},this)">Delete</button></div></div>`;
    // Game form — reordered: Date, Opponent, Location, Weather, Runs For, Runs Against
    const dateMin=activeSeason+'-01-01', dateMax=activeSeason+'-12-31';
    html+=`<div class="game-form">`;
    html+=`<div><label>Date</label><input type="date" value="${esc(g.date||'')}" min="${dateMin}" max="${dateMax}" onchange="updGameNoRerender('${g.id}','date',this.value);updateGameTab('${g.id}',this.value)"></div>`;
    html+=`<div><label>Time</label><input type="time" value="${esc(g.time||'')}" onchange="updGameNoRerender('${g.id}','time',this.value)"></div>`;
    html+=`<div><label>Opponent</label><input value="${esc(g.opponent||'')}" placeholder="Team" oninput="updGameNoRerender('${g.id}','opponent',this.value)"></div>`;
    html+=`<div><label>Location</label><input value="${esc(g.location||'')}" placeholder="Field name or address" oninput="updGameNoRerender('${g.id}','location',this.value)"></div>`;
    html+=`<div><label>Conditions</label><input value="${esc(g.weather||'')}" placeholder="Sunny, rainy, etc." oninput="updGameNoRerender('${g.id}','weather',this.value)"></div>`;
    html+=`<div><label>Runs For</label><input type="number" min="0" value="${esc(g.runsFor||'')}" placeholder="0" oninput="updGameNoRerender('${g.id}','runsFor',this.value)"></div>`;
    html+=`<div><label>Runs Against</label><input type="number" min="0" value="${esc(g.runsAgainst||'')}" placeholder="0" oninput="updGameNoRerender('${g.id}','runsAgainst',this.value)"></div>`;
    html+=`<div><label>Line Score — Away</label><input value="${esc(g.lineScoreAway||'')}" placeholder="e.g. 0,3,1,0,2" oninput="updGameNoRerender('${g.id}','lineScoreAway',this.value)"></div>`;
    html+=`<div><label>Line Score — Home</label><input value="${esc(g.lineScoreHome||'')}" placeholder="e.g. 2,0,0,1,4" oninput="updGameNoRerender('${g.id}','lineScoreHome',this.value)"></div>`;
    html+=`</div>`;
    // Location → Google Maps link if filled
    if(g.location){html+=`<div style="margin-bottom:10px"><a href="https://www.google.com/maps/search/${encodeURIComponent(g.location)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);display:inline-flex;align-items:center;gap:3px;text-decoration:none"><span class="material-symbols-outlined" style="font-size:14px">map</span>Open in Google Maps</a></div>`}
    // Multi-select roster picker ABOVE the table
    const currentNames=new Set((g.players||[]).map(p=>(p.name||'').trim().toLowerCase()));
    const available=D.roster.filter(r=>r.name&&!currentNames.has(r.name.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
    if(available.length){
      html+=`<div class="roster-picker"><span style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin-right:6px">Add:</span>`;
      available.forEach(r=>{
        html+=`<button class="roster-picker-chip" onclick="addNamedPlayerToGame('${g.id}','${esc(r.name.replace(/'/g,"\\'"))}')">${esc(r.name)}${r.number?' <span class="rp-num">#'+esc(r.number)+'</span>':''}</button>`;
      });
      html+=`<button class="roster-picker-chip" style="border-style:dashed;color:var(--mut)" onclick="addGuestToGame('${g.id}')"><span class="material-symbols-outlined" style="font-size:13px">person_add</span>Guest</button>`;
      html+=`</div>`;
    }else{
      html+=`<div style="margin-bottom:10px"><button class="btn btn-sm btn-ghost" onclick="addGuestToGame('${g.id}')"><span class="material-symbols-outlined" style="font-size:13px">person_add</span> Guest</button></div>`;
    }
    // Selection toolbar + stat table
    html+=`<div class="bs-toolbar" id="bsToolbar-${g.id}"></div>`;
    html+=`<div style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px">Hitting</div>`;
    html+=`<div class="table-wrap"><table><thead><tr><th style="width:24px"></th><th style="width:24px"></th><th>Player</th><th>Pos</th>`;es.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`</tr></thead><tbody id="bsBody-${g.id}">`;
    (g.players||[]).forEach((p,pi)=>{const dn=playerDisplayName(p);html+=`<tr class="bs-row" draggable="true" data-pid="${p.id}" data-gid="${g.id}" data-idx="${pi}"><td><input type="checkbox" class="row-check" data-pid="${p.id}" onchange="updateBsToolbar('${g.id}')"></td><td><span class="drag-handle material-symbols-outlined">drag_indicator</span></td><td><input class="cell-input wide" value="${esc(dn)}" placeholder="Name" oninput="updPlayer('${g.id}','${p.id}','name',this.value)"></td><td><input class="cell-input" style="width:80px" value="${esc(p.pos||'')}" placeholder="—" oninput="updPlayer('${g.id}','${p.id}','pos',this.value)"></td>`;es.forEach(s=>{html+=`<td><input class="cell-input" type="number" min="0" value="${esc(p[s.id]||'')}" oninput="updPlayer('${g.id}','${p.id}','${s.id}',this.value)"></td>`});html+=`</tr>`});
    if((g.players||[]).length){html+=`<tr class="total-row"><td></td><td></td><td>TEAM</td><td></td>`;es.forEach(s=>{html+=`<td>${(g.players||[]).reduce((sum,p)=>sum+n(p[s.id]),0)}</td>`});html+=`</tr>`}
    html+=`</tbody></table></div>`;
    // Pitching lines
    if(!g.pitching)g.pitching=[];
    const PSTATS=[{id:'ip',label:'IP',full:'Innings Pitched'},{id:'ph',label:'H',full:'Hits'},{id:'pr',label:'R',full:'Runs'},{id:'phbp',label:'HBP',full:'Hit-by-Pitch'},{id:'pbb',label:'BB',full:'Walks'},{id:'pk',label:'K',full:'Strikeouts'}];
    html+=`<div style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 4px">Pitching</div>`;
    // Pitcher picker
    const pitcherNames=new Set((g.pitching||[]).map(p=>(p.name||'').trim().toLowerCase()));
    const availPitchers=D.roster.filter(r=>r.name&&!pitcherNames.has(r.name.trim().toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
    html+=`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">`;
    availPitchers.forEach(r=>{
      html+=`<button class="roster-picker-chip" onclick="addPitcher('${g.id}','${esc(r.name.replace(/'/g,"\\'"))}')">${esc(r.name)}${r.number?' <span class="rp-num">#'+esc(r.number)+'</span>':''}</button>`;
    });
    html+=`<button class="roster-picker-chip" style="border-style:dashed;color:var(--mut)" onclick="addPitcher('${g.id}','')"><span class="material-symbols-outlined" style="font-size:13px">person_add</span>Guest</button>`;
    html+=`</div>`;
    if(g.pitching.length){
      html+=`<div class="table-wrap"><table><thead><tr><th>Pitcher</th>`;PSTATS.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`<th style="width:24px"></th></tr></thead><tbody>`;
      g.pitching.forEach((p,pi)=>{
        html+=`<tr><td><input class="cell-input wide" value="${esc(p.name||'')}" placeholder="Name" oninput="updPitcher('${g.id}',${pi},'name',this.value)"></td>`;
        PSTATS.forEach(s=>{html+=`<td><input class="cell-input" type="number" min="0" step="${s.id==='ip'?'0.1':'1'}" value="${esc(p[s.id]||'')}" oninput="updPitcher('${g.id}',${pi},'${s.id}',this.value)"></td>`});
        html+=`<td><button class="rm-btn" onclick="rmPitcher('${g.id}',${pi})">✕</button></td></tr>`;
      });
      html+=`</tbody></table></div>`;
    }
    // Notes
    html+=`<div class="box-notes"><label>Game Notes</label><textarea placeholder="Anything notable — weather delays, highlights, lineup changes, umpire rulings..." oninput="updGameNoRerender('${g.id}','notes',this.value)">${esc(g.notes||'')}</textarea></div>`;
    html+=`</div>`;
    area.innerHTML=html;
    initBoxScoreDrag(g.id);
  }else{
    // Read-only box score with player chips
    const timeStr=g.time?(' '+fmtTime(g.time)):'';
    let html=`<div class="card card-pad"><h3 style="font-size:18px;font-weight:900;margin-bottom:6px">Game ${gi+1}${g.date?' — '+fmtDateShort(g.date)+timeStr:''}${g.opponent?' vs '+esc(g.opponent):''}</h3>`;
    if(g.location){html+=`<div style="margin-bottom:8px"><a href="https://www.google.com/maps/search/${encodeURIComponent(g.location)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--blue);display:inline-flex;align-items:center;gap:3px;text-decoration:none"><span class="material-symbols-outlined" style="font-size:14px">map</span>${esc(g.location)}</a></div>`}
    if(g.runsFor||g.runsAgainst){
      const w=n(g.runsFor)>n(g.runsAgainst),l=n(g.runsFor)<n(g.runsAgainst),r=w?'W':l?'L':'T',bg=w?'var(--win)':l?'var(--loss)':'var(--tie)';
      html+=`<div style="margin-bottom:12px"><span class="result-tag" style="background:${bg};font-size:14px;padding:4px 12px">${r} ${esc(g.runsFor)} – ${esc(g.runsAgainst)}</span></div>`;
    }
    const bsMid=Math.ceil(es.length/2);const bsA=es.slice(0,bsMid),bsB=es.slice(bsMid);
    const hasPos=(g.players||[]).some(p=>p.pos);
    // Full table (desktop)
    html+=`<div style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px">Hitting</div>`;
    html+=`<div class="table-wrap bs-full"><table><thead><tr><th>Player</th>${hasPos?'<th>Pos</th>':''}`;es.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`</tr></thead><tbody>`;
    (g.players||[]).forEach(p=>{const dn=playerDisplayName(p);if(!dn)return;html+=`<tr><td style="font-weight:600">${playerChip(dn)}</td>${hasPos?'<td style="font-size:11px;color:var(--mut)">'+esc(p.pos||'')+'</td>':''}`;es.forEach(s=>{html+=`<td>${p[s.id]!=null&&p[s.id]!==''?p[s.id]:'—'}</td>`});html+=`</tr>`});
    if((g.players||[]).length){html+=`<tr class="total-row"><td>TEAM</td>${hasPos?'<td></td>':''}`;es.forEach(s=>{html+=`<td>${(g.players||[]).reduce((sum,p)=>sum+n(p[s.id]),0)}</td>`});html+=`</tr>`}
    html+=`</tbody></table></div>`;
    // Mobile split tables
    html+=`<div class="bs-mobile"><div class="table-wrap"><table><thead><tr><th>Player</th>${hasPos?'<th>Pos</th>':''}`;bsA.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`</tr></thead><tbody>`;
    (g.players||[]).forEach(p=>{const dn=playerDisplayName(p);if(!dn)return;html+=`<tr><td style="font-weight:600">${playerChip(dn)}</td>${hasPos?'<td style="font-size:11px;color:var(--mut)">'+esc(p.pos||'')+'</td>':''}`;bsA.forEach(s=>{html+=`<td>${p[s.id]!=null&&p[s.id]!==''?p[s.id]:'—'}</td>`});html+=`</tr>`});
    if((g.players||[]).length){html+=`<tr class="total-row"><td>TEAM</td>${hasPos?'<td></td>':''}`;bsA.forEach(s=>{html+=`<td>${(g.players||[]).reduce((sum,p)=>sum+n(p[s.id]),0)}</td>`});html+=`</tr>`}
    html+=`</tbody></table></div>`;
    html+=`<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Player</th>`;bsB.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`</tr></thead><tbody>`;
    (g.players||[]).forEach(p=>{const dn=playerDisplayName(p);if(!dn)return;html+=`<tr><td style="font-weight:600">${playerChip(dn)}</td>`;bsB.forEach(s=>{html+=`<td>${p[s.id]!=null&&p[s.id]!==''?p[s.id]:'—'}</td>`});html+=`</tr>`});
    if((g.players||[]).length){html+=`<tr class="total-row"><td>TEAM</td>`;bsB.forEach(s=>{html+=`<td>${(g.players||[]).reduce((sum,p)=>sum+n(p[s.id]),0)}</td>`});html+=`</tr>`}
    html+=`</tbody></table></div></div>`;
    // Read-only pitching lines
    const PSTATS=[{id:'ip',label:'IP',full:'Innings Pitched'},{id:'ph',label:'H',full:'Hits'},{id:'pr',label:'R',full:'Runs'},{id:'phbp',label:'HBP',full:'Hit-by-Pitch'},{id:'pbb',label:'BB',full:'Walks'},{id:'pk',label:'K',full:'Strikeouts'}];
    if(g.pitching&&g.pitching.length){
      html+=`<div style="font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 4px">Pitching</div>`;
      html+=`<div class="table-wrap"><table><thead><tr><th>Pitcher</th>`;PSTATS.forEach(s=>{html+=`<th title="${esc(s.full)}">${esc(s.label)}</th>`});html+=`</tr></thead><tbody>`;
      (g.pitching||[]).forEach(p=>{html+=`<tr><td style="font-weight:600">${playerChip(p.name)}</td>`;PSTATS.forEach(s=>{html+=`<td>${p[s.id]!=null&&p[s.id]!==''?p[s.id]:'—'}</td>`});html+=`</tr>`});
      html+=`</tbody></table></div>`;
    }
    if(g.notes)html+=`<div style="margin-top:12px;padding:10px 14px;background:rgba(26,39,68,0.02);border-radius:var(--radius);font-size:13px;color:#666;line-height:1.6;white-space:pre-wrap">${esc(g.notes)}</div>`;
    html+=`</div>`;
    area.innerHTML=html;
  }
}
function delGame(i,btn){if(btn.dataset.confirm){D.games.splice(i,1);activeGame=null;saveNow();renderAll();return}btn.dataset.confirm='1';btn.textContent='Confirm delete';setTimeout(()=>{if(btn.isConnected){delete btn.dataset.confirm;btn.textContent='Delete'}},3000)}
// Update game field WITHOUT re-rendering (prevents focus loss)
function updGameNoRerender(gid,k,v){const g=D.games.find(x=>x.id===gid);if(g)g[k]=v}
// Update game field AND re-render (for date changes that affect tabs)
function updateGameTab(gid,v){
  const g=D.games.find(x=>x.id===gid);if(!g)return;
  // Update the tab label without full re-render
  const tabs=document.getElementById('gameTabs');
  if(tabs){const gi=D.games.indexOf(g);const btns=tabs.querySelectorAll('.game-tab');if(btns[gi])btns[gi].textContent=v||`Game ${gi+1}`}
  // Update the heading
  const gi=D.games.indexOf(g);
  const heading=document.querySelector('#boxScoreArea h3');
  if(heading)heading.textContent=`Game ${gi+1}${v?' — '+fmtDateShort(v):''}`;
}
function updPlayer(gid,pid,k,v){
  const g=D.games.find(x=>x.id===gid);
  if(!g)return;
  (g.players||[]).forEach(p=>{
    if(p.id===pid){
      p[k]=v;
      // Auto-link to roster when name changes
      if(k==='name'){
        const m=matchRoster(v);
        p.rosterId=m?m.rosterId:'';
      }
    }
  });
}
// Add a named roster player to the game (chip click)
function addNamedPlayerToGame(gid,name){
  const g=D.games.find(x=>x.id===gid);if(!g)return;
  if(!g.players)g.players=[];
  const rosterEntry=D.roster.find(r=>r.name===name);
  g.players.push({id:uid(),name:name,rosterId:rosterEntry?rosterEntry.id:''});
  renderBoxScores();
}
// Add a guest (non-roster) player
function addGuestToGame(gid){
  const g=D.games.find(x=>x.id===gid);if(!g)return;
  if(!g.players)g.players=[];
  g.players.push({id:uid(),name:'',rosterId:''});
  renderBoxScores();
  // Focus the new empty name input
  setTimeout(()=>{const inputs=document.querySelectorAll('#boxScoreArea .cell-input.wide');if(inputs.length)inputs[inputs.length-1].focus()},50);
}
function rmPlayer(gid,pid){const g=D.games.find(x=>x.id===gid);if(g)g.players=(g.players||[]).filter(p=>p.id!==pid);renderBoxScores()}
/* ═══ PITCHING HELPERS ═══ */
function addPitcher(gid,name){const g=D.games.find(x=>x.id===gid);if(!g)return;if(!g.pitching)g.pitching=[];g.pitching.push({name:name});renderBoxScores()}
function updPitcher(gid,idx,k,v){const g=D.games.find(x=>x.id===gid);if(g&&g.pitching&&g.pitching[idx])g.pitching[idx][k]=v}
function rmPitcher(gid,idx){const g=D.games.find(x=>x.id===gid);if(g&&g.pitching)g.pitching.splice(idx,1);renderBoxScores()}

/* ═══ BOX SCORE ROW SELECTION + MULTI-DELETE ═══ */
function getSelectedPids(gid){
  const checks=document.querySelectorAll(`#bsBody-${gid} .row-check:checked`);
  return Array.from(checks).map(c=>c.dataset.pid);
}
function updateBsToolbar(gid){
  const tb=document.getElementById('bsToolbar-'+gid);if(!tb)return;
  const sel=getSelectedPids(gid);
  if(!sel.length){tb.innerHTML='';return}
  tb.innerHTML=`<span class="sel-count">${sel.length} selected</span><button class="del-selected" onclick="deleteSelectedPlayers('${gid}')"><span class="material-symbols-outlined" style="font-size:14px">delete</span>Remove ${sel.length}</button><button style="border:none;background:transparent;color:var(--mut);font-size:11px;font-weight:600;cursor:pointer" onclick="clearSelection('${gid}')">Cancel</button>`;
}
function deleteSelectedPlayers(gid){
  const pids=new Set(getSelectedPids(gid));
  if(!pids.size)return;
  const g=D.games.find(x=>x.id===gid);if(!g)return;
  g.players=(g.players||[]).filter(p=>!pids.has(p.id));
  renderBoxScores();
}
function clearSelection(gid){
  document.querySelectorAll(`#bsBody-${gid} .row-check`).forEach(c=>c.checked=false);
  updateBsToolbar(gid);
}

/* ═══ BOX SCORE ROW DRAG-AND-DROP ═══ */
let dragSrcRow=null;
function initBoxScoreDrag(gid){
  const tbody=document.getElementById('bsBody-'+gid);if(!tbody)return;
  const rows=tbody.querySelectorAll('tr.bs-row');
  rows.forEach(row=>{
    row.addEventListener('dragstart',e=>{
      dragSrcRow=row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',row.dataset.pid);
    });
    row.addEventListener('dragend',()=>{
      row.classList.remove('dragging');
      dragSrcRow=null;
      rows.forEach(r=>r.style.borderTop='');
    });
    row.addEventListener('dragover',e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      if(dragSrcRow&&dragSrcRow!==row){
        row.style.borderTop='2px solid var(--acc)';
      }
    });
    row.addEventListener('dragleave',()=>{
      row.style.borderTop='';
    });
    row.addEventListener('drop',e=>{
      e.preventDefault();
      row.style.borderTop='';
      if(!dragSrcRow||dragSrcRow===row)return;
      const g=D.games.find(x=>x.id===gid);if(!g||!g.players)return;
      const fromIdx=parseInt(dragSrcRow.dataset.idx);
      const toIdx=parseInt(row.dataset.idx);
      if(isNaN(fromIdx)||isNaN(toIdx))return;
      // Move the player in the array
      const [moved]=g.players.splice(fromIdx,1);
      g.players.splice(toIdx,0,moved);
      renderBoxScores();
    });
  });
}

/* ═══ PLAYER STATS ═══ */
function getPlayerTotals(){
  const map={};
  D.games.forEach(g=>{(g.players||[]).forEach(p=>{
    const dn=playerDisplayName(p);
    if(!dn)return;
    // Key by rosterId if linked, otherwise by lowercase name
    const key=p.rosterId||dn.trim().toLowerCase();
    if(!map[key])map[key]={name:dn,gp:0};
    // Prefer the longer/fuller name
    if(dn.length>map[key].name.length)map[key].name=dn;
    map[key].gp++;
    enabledStats().forEach(s=>{map[key][s.id]=(map[key][s.id]||0)+n(p[s.id])});
  })});
  return Object.values(map).sort((a,b)=>(b.h||0)-(a.h||0));
}
function sortPlayerStats(col){
  if(playerStatsSort.col===col){playerStatsSort.dir=playerStatsSort.dir==='desc'?'asc':'desc'}
  else{playerStatsSort.col=col;playerStatsSort.dir=col==='name'?'asc':'desc'}
  renderPlayerStats();
}
function renderPlayerStats(){const pl=getPlayerTotals();const es=enabledStats();if(!pl.length){document.getElementById('playerStatsArea').innerHTML='<div class="empty"><div class="empty-text">No player data yet.</div></div>';return}
  // Sort
  if(playerStatsSort.col){
    const c=playerStatsSort.col,d=playerStatsSort.dir==='asc'?1:-1;
    pl.sort((a,b)=>{
      let va,vb;
      if(c==='name'){va=(a.name||'').toLowerCase();vb=(b.name||'').toLowerCase();return va<vb?-d:va>vb?d:0}
      if(c==='gp'){va=a.gp||0;vb=b.gp||0}
      else if(c==='avg'){va=a.ab?a.h/a.ab:0;vb=b.ab?b.h/b.ab:0}
      else{va=a[c]||0;vb=b[c]||0}
      return (va-vb)*d;
    });
  }
  function sc(col){return playerStatsSort.col===col?(playerStatsSort.dir==='asc'?' sort-asc':' sort-desc'):''}
  let html=`<div class="table-wrap ps-full"><table><thead><tr><th class="sortable${sc('name')}" onclick="sortPlayerStats('name')">Player</th><th class="sortable${sc('gp')}" onclick="sortPlayerStats('gp')">GP</th>`;es.forEach(s=>{html+=`<th class="sortable${sc(s.id)}" title="${esc(s.full)}" onclick="sortPlayerStats('${s.id}')">${esc(s.label)}</th>`});html+=`<th class="sortable${sc('avg')}" onclick="sortPlayerStats('avg')">AVG</th></tr></thead><tbody>`;pl.forEach(p=>{html+=`<tr><td style="font-weight:600">${playerPhotoHtml(p.name)}${esc(p.name)}</td><td style="text-align:center">${p.gp}</td>`;es.forEach(s=>{html+=`<td>${p[s.id]||0}</td>`});html+=`<td class="calc-cell">${avg3(p.h||0,p.ab||0)}</td></tr>`});html+=`</tbody></table></div>`;
  // Mobile split tables
  const midIdx=Math.ceil(es.length/2);
  const esA=es.slice(0,midIdx),esB=es.slice(midIdx);
  html+=`<div class="ps-mobile"><div class="table-wrap"><table><thead><tr><th class="sortable${sc('name')}" onclick="sortPlayerStats('name')">Player</th><th class="sortable${sc('gp')}" onclick="sortPlayerStats('gp')">GP</th>`;esA.forEach(s=>{html+=`<th class="sortable${sc(s.id)}" title="${esc(s.full)}" onclick="sortPlayerStats('${s.id}')">${esc(s.label)}</th>`});html+=`<th class="sortable${sc('avg')}" onclick="sortPlayerStats('avg')">AVG</th></tr></thead><tbody>`;pl.forEach(p=>{html+=`<tr><td style="font-weight:600">${playerPhotoHtml(p.name,18)}${esc(p.name)}</td><td style="text-align:center">${p.gp}</td>`;esA.forEach(s=>{html+=`<td>${p[s.id]||0}</td>`});html+=`<td class="calc-cell">${avg3(p.h||0,p.ab||0)}</td></tr>`});html+=`</tbody></table></div>`;
  html+=`<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th class="sortable${sc('name')}" onclick="sortPlayerStats('name')">Player</th>`;esB.forEach(s=>{html+=`<th class="sortable${sc(s.id)}" title="${esc(s.full)}" onclick="sortPlayerStats('${s.id}')">${esc(s.label)}</th>`});html+=`</tr></thead><tbody>`;pl.forEach(p=>{html+=`<tr><td style="font-weight:600">${playerPhotoHtml(p.name,18)}${esc(p.name)}</td>`;esB.forEach(s=>{html+=`<td>${p[s.id]||0}</td>`});html+=`</tr>`});html+=`</tbody></table></div></div>`;
  document.getElementById('playerStatsArea').innerHTML=html}

/* ═══ LEADERBOARDS ═══ */
function renderLeaderboards(){const pl=getPlayerTotals();const es=enabledStats();const grid=document.getElementById('leadersGrid');if(!pl.length){grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="empty-text">No data yet.</div></div>';return}let html='';es.forEach(s=>{const top=[...pl].sort((a,b)=>(b[s.id]||0)-(a[s.id]||0)).slice(0,5);if(!top.length||!top[0][s.id])return;html+=`<div class="card" style="padding:14px 16px"><div class="leader-title">${esc(s.full)}</div>`;top.forEach((p,i)=>{html+=`<div class="leader-row"><span class="leader-name${i===0?' top':''}">${i===0?'👑 ':(i+1)+'. '}${esc(p.name)}</span><span class="leader-val">${p[s.id]||0}</span></div>`});html+=`</div>`});grid.innerHTML=html||'<div class="empty" style="grid-column:1/-1"><div class="empty-text">No data yet.</div></div>'}

/* ═══ TRENDTRACKER ═══ */
function toggleTrendStat(id){if(trendStats.has(id)){if(trendStats.size>1)trendStats.delete(id)}else{trendStats.add(id)}renderTrendTracker()}
function renderTrendTracker(){
  const es=enabledStats();
  // Stat pills (multi-select)
  const pp=document.getElementById('trendPills');pp.innerHTML='';
  es.forEach(s=>{const b=document.createElement('button');b.className='trend-pill'+(trendStats.has(s.id)?' active':'');b.textContent=s.full;b.onclick=()=>toggleTrendStat(s.id);pp.appendChild(b)});
  // Player pills
  const plp=document.getElementById('trendPlayerPills');plp.innerHTML='';
  const players=getPlayerTotals().filter(p=>p.gp>0);
  const tb=document.createElement('button');tb.className='trend-pill'+(trendPlayer==='team'?' active':'');tb.textContent='Team Total';tb.onclick=()=>{trendPlayer='team';renderTrendTracker()};plp.appendChild(tb);
  players.forEach(p=>{const b=document.createElement('button');b.className='trend-pill'+(trendPlayer===p.name?' active':'');b.textContent=p.name;b.onclick=()=>{trendPlayer=p.name;renderTrendTracker()};plp.appendChild(b)});
  // Build datasets
  const COLORS=['#e8a838','#3b5998','#2d6a2e','#b22','#8b5cf6','#0891b2','#c2410c','#6d28d9'];
  const games=D.games.filter(g=>g.date);
  const labels=games.map((g,i)=>`G${i+1}`);
  const datasets=[];
  let ci=0;
  trendStats.forEach(statId=>{
    const sInfo=es.find(s=>s.id===statId)||{full:statId};
    const color=COLORS[ci%COLORS.length];ci++;
    const data=games.map(g=>{
      if(trendPlayer==='team'){return(g.players||[]).reduce((sum,p)=>sum+n(p[statId]),0)}
      else{const pl=(g.players||[]).find(p=>{const dn=playerDisplayName(p);return dn.toLowerCase()===trendPlayer.toLowerCase()});return pl?n(pl[statId]):0}
    });
    datasets.push({label:sInfo.full+(trendPlayer!=='team'?' ('+trendPlayer+')':''),data,borderColor:color,backgroundColor:color+'1a',borderWidth:2,pointBackgroundColor:color,pointRadius:4,pointHoverRadius:6,tension:0.3,fill:false});
  });
  if(trendChartInstance){trendChartInstance.destroy();trendChartInstance=null}
  const ctx=document.getElementById('trendChart');
  if(games.length&&datasets.length){trendChartInstance=new Chart(ctx,{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:datasets.length>1,labels:{font:{family:'Sen',size:11}}}},scales:{x:{grid:{display:false},ticks:{font:{family:'Sen',size:11}}},y:{beginAtZero:true,grid:{color:'#f0efe8'},ticks:{font:{family:'Sen',size:11}}}}}})}
  // Table
  const selStats=[...trendStats].map(id=>es.find(s=>s.id===id)||{id,full:id,label:id});
  let thtml='';
  if(games.length){
    thtml=`<div class="table-wrap"><table><thead><tr><th>Game</th><th>Date</th><th>Opp</th>`;
    selStats.forEach(s=>{thtml+=`<th>${esc(s.label)}</th>`});
    thtml+=`</tr></thead><tbody>`;
    games.forEach((g,i)=>{
      thtml+=`<tr><td>G${i+1}</td><td>${esc(g.date)}</td><td>${esc(g.opponent||'TBD')}</td>`;
      selStats.forEach(s=>{
        let val;
        if(trendPlayer==='team'){val=(g.players||[]).reduce((sum,p)=>sum+n(p[s.id]),0)}
        else{const pl=(g.players||[]).find(p=>playerDisplayName(p).toLowerCase()===trendPlayer.toLowerCase());val=pl?n(pl[s.id]):0}
        thtml+=`<td class="calc-cell">${val}</td>`;
      });
      thtml+=`</tr>`;
    });
    thtml+=`</tbody></table></div>`;
  }
  document.getElementById('trendTable').innerHTML=thtml;
}
function renderStatNotes(){
  document.getElementById('statNotesArea').value=D.cfg.statNotes||'';
  if(isAdmin() && activeTab==='statnotes') enterEditContext('statnotes');
}

/* ═══ SETTINGS ═══ */
const STABS=[{id:'general',label:'General'},{id:'tabs',label:'Tabs'},{id:'stats',label:'Stats'},{id:'import',label:'Import CSV'},{id:'tools',label:'Tools'},{id:'backlog',label:'Backlog'}];
function renderSettings(){
  // Settings are admin-only
  if(!isAdmin()){
    document.getElementById('settingsNav').innerHTML='';
    document.getElementById('settingsArea').innerHTML='<div class="empty"><div class="empty-text">Settings are admin-only.</div></div>';
    return;
  }
  const sn=document.getElementById('settingsNav');sn.innerHTML='';STABS.forEach(t=>{const b=document.createElement('button');b.className='settings-pill'+(settingsSub===t.id?' active':'');b.textContent=t.label;b.onclick=()=>{settingsSub=t.id;renderSettings()};sn.appendChild(b)});const area=document.getElementById('settingsArea');let html='';
if(activeTab==='settings') enterEditContext('settings');
if(settingsSub==='general'){html=`<div class="s-card"><h3>General</h3>`;[['teamName','Team Name'],['seasonLabel','Season Label']].forEach(([k,l])=>{html+=`<div class="s-field"><label class="s-label">${l}</label><input class="s-input" value="${esc(D.cfg[k]||'')}" oninput="D.cfg['${k}']=this.value;renderHome()"></div>`});html+=`</div>`;
html+=`<div class="s-card"><h3>Admin Allowlist</h3><p style="font-size:12px;color:var(--mut);margin-bottom:8px">Only these Google email addresses can create/edit content. Everyone else gets read-only access. Edit the ADMIN_EMAILS array in the HTML source.</p><div style="font-family:monospace;font-size:12px;background:#f8f7f3;padding:10px;border-radius:6px;color:#666">${ADMIN_EMAILS.length?ADMIN_EMAILS.map(e=>esc(e)).join('<br>'):'<em>No emails configured — edit ADMIN_EMAILS in HTML</em>'}</div></div>`}
if(settingsSub==='tabs'){html=`<div class="s-card"><h3>Tab Visibility</h3>`;[['showHome','Feed'],['showRoster','Roster'],['showBoxScores','Box Scores'],['showPlayerStats','Player Stats'],['showLeaderboards','Leaderboards'],['showTrendTracker','TrendTracker'],['showStatNotes','Stat Notes']].forEach(([k,l])=>{html+=`<div class="toggle-row"><span>${l}</span><div class="toggle${D.cfg[k]?' on':''}" onclick="D.cfg['${k}']=!D.cfg['${k}'];renderAll()"><div class="knob"></div></div></div>`});html+=`</div>`}
if(settingsSub==='stats'){html=`<div class="s-card"><h3>Stat Categories</h3>`;(D.cfg.stats||[]).forEach((s,i)=>{html+=`<div class="stat-config-row"><div class="toggle${s.on?' on':''}" onclick="D.cfg.stats[${i}].on=!D.cfg.stats[${i}].on;renderSettings()"><div class="knob"></div></div><input style="width:50px;font-weight:700" value="${esc(s.label)}" oninput="D.cfg.stats[${i}].label=this.value"><input style="flex:1" value="${esc(s.full)}" oninput="D.cfg.stats[${i}].full=this.value"><span class="sid">${esc(s.id)}</span></div>`});html+=`<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-sm" onclick="D.cfg.stats.push({id:'c_'+uid(),label:'NEW',full:'New Stat',on:true});renderSettings()">+ Add Stat</button></div></div>`}
if(settingsSub==='import'){
  html=`<div class="s-card"><h3>Import Game from CSV</h3>
  <p style="font-size:12px;color:var(--mut);margin-bottom:14px">Drop a game box score CSV exported from the NY Groove Stat Hub Google Sheet. The parser will do its best to extract the date, opponent, score, and player stats. You can clean up anything it gets wrong in the Box Scores tab afterward.</p>
  <div class="photo-drop" id="csvDropZone" onclick="document.getElementById('csvFileInput').click()" style="margin-bottom:14px">
    <span class="material-symbols-outlined" style="font-size:28px;display:block;margin-bottom:4px">upload_file</span>
    Click or drop a .csv file here
  </div>
  <input type="file" id="csvFileInput" accept=".csv" style="display:none" onchange="handleCsvImport(this.files[0])">
  <div id="csvImportResult"></div></div>`;
}
if(settingsSub==='tools'){
  html=`<div class="s-card"><h3>Profile Completion Modal</h3>
  <p style="font-size:12px;color:var(--mut);margin-bottom:14px">Test the modal that prompts players to fill in missing photo/hometown. Pick a player below or trigger it for everyone who's incomplete.</p>
  <div style="display:flex;flex-direction:column;gap:8px">`;
  // List players missing photo or hometown
  const incomplete = D.roster.map((r,i)=>({r,i})).filter(({r})=>!r.photo||!r.hometown||!r.hometown.trim());
  if(incomplete.length){
    incomplete.forEach(({r,i})=>{
      const missing=[];
      if(!r.photo) missing.push('photo');
      if(!r.hometown||!r.hometown.trim()) missing.push('hometown');
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg);border-radius:8px">
        <div><span style="font-weight:700;font-size:13px">${esc(r.name||'Unnamed')}</span> <span style="font-size:11px;color:var(--mut)">— missing ${missing.join(', ')}</span></div>
        <button class="save-btn" style="font-size:11px;padding:5px 14px" onclick="_profileModalShown=false;openProfileEditor(${i},true)">Test Modal</button>
      </div>`;
    });
  } else {
    html+=`<div style="font-size:13px;color:var(--mut)">All players have both a photo and hometown filled in.</div>`;
  }
  html+=`</div></div>`;

  // Bulk Upload Photos
  html+=`<div class="s-card"><h3>Bulk Upload Photos</h3>
  <p style="font-size:12px;color:var(--mut);margin-bottom:14px">Upload multiple photos at once. Filenames are matched to roster names automatically.</p>
  <div class="photo-drop" onclick="document.getElementById('bulkPhotoInput').click()" style="margin-bottom:8px">
    <span class="material-symbols-outlined" style="font-size:28px;display:block;margin-bottom:4px">photo_library</span>
    Click or drop photos here
  </div>
  <input type="file" id="bulkPhotoInput" accept="image/*" multiple style="display:none" onchange="handleBulkPhotos(this.files)">
  </div>`;

  // Delete All Roster Photos
  const photosCount = D.roster.filter(r=>r.photo).length;
  html+=`<div class="s-card"><h3>Delete All Roster Photos</h3>
  <p style="font-size:12px;color:var(--mut);margin-bottom:14px">Remove photos from all roster entries. Players who sign in and update their profile will get their photo back — this lets you see who has and hasn't completed their profile.</p>
  <div style="font-size:13px;margin-bottom:12px"><strong>${photosCount}</strong> player${photosCount===1?'':'s'} currently ${photosCount===1?'has':'have'} a photo.</div>
  <button class="del-btn" style="font-size:13px;padding:8px 16px" onclick="confirmDeleteAllPhotos(this)"${photosCount===0?' disabled':''}>
    <span class="material-symbols-outlined" style="font-size:16px">delete</span>Delete all photos
  </button>
  </div>`;
}
if(settingsSub==='backlog'){
  const BACKLOG=[
    'Player tagging — @mention players in write-ups, photo captions; auto-backlink to their roster card',
    'Headshot upload per player on roster cards',
    'Player names in box scores link back to roster page',
    'Post editing — edit published posts after the fact',
    'About page with team history, committee info, alumni section',
    'Contact / Get Involved button for new members',
    'Schedule integration — GCal embed or manual game schedule',
    'Positions played tracking per game in box scores',
    '"Log a Game" wizard — combined box score entry + game recap in one flow',
    'Rich text in posts — Markdown or simple bold/italic/links toolbar',
    'Photo gallery / lightbox view for photo posts',
    'Line score (innings breakdown) embedded in Game Recap posts',
    'Search / filter on the feed by post type, date, or author',
    'Reactions / likes on posts for friends and family',
    'Dark mode toggle',
    'Pin / reorder important posts',
    'Mobile bottom tab bar instead of sidebar',
    'Data validation on box score stat inputs (numbers only)',
  ];
  html=`<div class="s-card"><h3>Feature Backlog</h3>`;
  BACKLOG.forEach(b=>{
    html+=`<div style="padding:7px 0;border-bottom:1px solid #f5f3ed;font-size:13px;color:#555">${esc(b)}</div>`;
  });
  html+=`</div>`;
}
area.innerHTML=html}

/* ═══ CSV IMPORT ═══ */
function parseCsvText(text){
  // Simple CSV parser that handles quoted fields
  const rows=[];let row=[];let cell='';let inQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQuote){
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(c==='"'){inQuote=false}
      else{cell+=c}
    }else{
      if(c==='"'){inQuote=true}
      else if(c===','){row.push(cell);cell=''}
      else if(c==='\n'||c==='\r'){
        if(c==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);rows.push(row);row=[];cell='';
      }else{cell+=c}
    }
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows;
}

function handleCsvImport(file){
  if(!file)return;
  const result=document.getElementById('csvImportResult');
  result.innerHTML='<p style="color:var(--mut)">Parsing...</p>';
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const rows=parseCsvText(e.target.result);
      const game=parseCsvToGame(rows);
      if(!game){result.innerHTML='<p style="color:var(--loss)">Could not parse this CSV. Make sure it\'s a game box score tab from the Stat Hub sheet.</p>';return}
      // Show preview
      const pCount=game.players.length;
      const resultTag=game.runsFor&&game.runsAgainst?(parseInt(game.runsFor)>parseInt(game.runsAgainst)?'W':'L'):'?';
      let preview=`<div class="s-card" style="margin-top:12px"><h3>Preview</h3>`;
      preview+=`<p style="font-size:13px;margin-bottom:8px"><strong>${game.date||'No date'}</strong> vs <strong>${game.opponent||'Unknown'}</strong> — ${game.runsFor||'?'}-${game.runsAgainst||'?'} (${resultTag})</p>`;
      preview+=`<p style="font-size:12px;color:var(--mut);margin-bottom:8px">${game.location||'No location'} · ${pCount} players</p>`;
      if(pCount){
        preview+=`<div style="font-size:11px;color:#666;margin-bottom:10px">`;
        game.players.forEach(p=>{preview+=`<span style="display:inline-block;padding:2px 8px;background:#f4f2ec;border-radius:4px;margin:2px">${esc(p.name||'?')}</span>`});
        preview+=`</div>`;
      }
      preview+=`<div style="display:flex;gap:8px"><button class="save-btn" onclick="commitCsvImport()">Import Game</button><button class="cancel-btn" onclick="document.getElementById('csvImportResult').innerHTML=''">Cancel</button></div></div>`;
      result.innerHTML=preview;
      // Stash the parsed game for commit
      window._pendingImport=game;
    }catch(err){
      result.innerHTML=`<p style="color:var(--loss)">Parse error: ${esc(err.message)}</p>`;
    }
  };
  reader.readAsText(file);
}

function parseCsvToGame(rows){
  if(rows.length<8)return null;
  const months={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};

  // Row 2: matchup, Row 3: location+date + team1 score, Row 4: team2 score
  const matchup=(rows[2]&&rows[2][2]||'').trim();
  const locRaw=(rows[3]&&rows[3][2]||'').trim();

  // Opponent
  let opponent='',isAway=false;
  if(matchup){
    if(matchup.includes('@')){
      const parts=matchup.split('@');
      if(parts[0].toLowerCase().includes('groove')||parts[0].toLowerCase().includes('new york')){
        isAway=true;opponent=parts[1].trim();
      }else{
        opponent=parts[0].trim();
      }
    }else{
      const m=matchup.match(/vs\.?\s*(.+)/i);
      if(m)opponent=m[1].trim();
    }
  }

  // Date
  let dateStr='';
  const dm=locRaw.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if(dm&&months[dm[1]])dateStr=`${dm[3]}-${months[dm[1]]}-${String(dm[2]).padStart(2,'0')}`;

  // Location
  const location=locRaw.split(',')[0].trim();

  // Find R column in row 2
  let rCol=null;
  if(rows[2])for(let i=0;i<rows[2].length;i++){if(rows[2][i].trim()==='R'){rCol=i;break}}

  // Determine Groove row
  let grooveRow=4,oppRow=3;
  const r3=(rows[3]||[]).slice(16,22).join('').toUpperCase();
  const r4=(rows[4]||[]).slice(16,22).join('').toUpperCase();
  if(r3.includes('GROOVE'))      {grooveRow=3;oppRow=4}
  else if(r4.includes('GROOVE')) {grooveRow=4;oppRow=3}
  else if(r3.includes('AWAY')&&isAway){grooveRow=3;oppRow=4}
  else if(r4.includes('HOME')&&!isAway){grooveRow=4;oppRow=3}
  else if(isAway){grooveRow=3;oppRow=4}

  const pn=v=>{if(!v)return '';const c=v.replace(/[^0-9.\-]/g,'');try{return String(parseInt(parseFloat(c)))}catch(e){return ''}};
  const runsFor=rCol!==null&&rows[grooveRow]&&rCol<rows[grooveRow].length?pn(rows[grooveRow][rCol]):'';
  const runsAgainst=rCol!==null&&rows[oppRow]&&rCol<rows[oppRow].length?pn(rows[oppRow][rCol]):'';

  // Find BATTING header
  let headerRow=null;
  for(let ri=0;ri<Math.min(rows.length,15);ri++){
    if(rows[ri]&&rows[ri][2]&&rows[ri][2].trim()==='Player'){headerRow=ri;break}
  }
  if(!headerRow)return null;

  // Column map
  const hdr=rows[headerRow];
  const statKeys={'Player':'name','#':'number','POS':'position','PA':'pa','AB':'ab','R':'r','H':'h','1B':'singles','2B':'doubles','3B':'triples','HR':'hr','RBI':'rbi','BB':'bb','K':'so','HBP':'hbp','SF':'sf','SB':'sb','CS':'cs'};
  const colMap={};
  hdr.forEach((c,ci)=>{
    const clean=c.trim().replace(/\n/g,'');
    if(statKeys[clean])colMap[statKeys[clean]]=ci;
    if(clean.includes('GI')&&clean.includes('DP'))colMap['gidp']=ci;
  });

  // Parse players
  const players=[];
  for(let ri=headerRow+1;ri<Math.min(headerRow+30,rows.length);ri++){
    const row=rows[ri];if(!row)break;
    const nameCi=colMap.name||2;
    if(nameCi>=row.length)break;
    const name=row[nameCi].trim();
    if(!name){
      const paCi=colMap.pa||5;
      if(paCi<row.length&&pn(row[paCi]))break;
      continue;
    }
    if(['PITCHING','BATTING','Player','Note:','Note'].includes(name.toUpperCase()))break;

    const player={id:uid(),name,rosterId:''};
    // Auto-link to roster
    const rm=matchRoster(name);
    if(rm){player.rosterId=rm.rosterId;player.name=rm.name}
    for(const[sk,ci]of Object.entries(colMap)){
      if(['name','number','position'].includes(sk))continue;
      if(ci<row.length){const v=pn(row[ci]);if(v)player[sk]=v}
    }
    players.push(player);
  }

  return{id:uid(),date:dateStr,opponent,location,runsFor,runsAgainst,weather:'',notes:'',players};
}

function commitCsvImport(){
  const game=window._pendingImport;
  if(!game)return;
  D.games.push(game);
  activeGame=game.id;
  activeTab='boxscores';
  saveNow();
  window._pendingImport=null;
  renderAll();
}

function renderAll(){
  // Exit edit context if we're on a read-only tab
  const editTabs = ['roster','boxscores','statnotes','settings'];
  if(_editContext && !editTabs.includes(activeTab)) exitEditContext();
  renderNav();renderTabs();renderHome();renderRoster();renderBoxScores();renderPlayerStats();renderLeaderboards();renderTrendTracker();renderStatNotes();renderSettings();
}

/* ═══ GRASS FIELD ANIMATION ═══ */
let grassAnimId = null;
function initGrass() {
  if (grassAnimId) return; // already running
  const canvas = document.getElementById('grassCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Blade pool — generated once, animated continuously
  let blades = [];
  const BLADE_COUNT = 220;
  const COLORS = ['#7db36a','#6ea55c','#8dc07a','#5c9648','#9acc88','#a3d196','#78ab65'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    generateBlades();
  }

  function generateBlades() {
    blades = [];
    const w = canvas.width, h = canvas.height;
    for (let i = 0; i < BLADE_COUNT; i++) {
      blades.push({
        x: Math.random() * w,
        baseY: h - Math.random() * 90,
        height: 30 + Math.random() * 70,
        width: 1.5 + Math.random() * 2.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.5,
        amplitude: 3 + Math.random() * 8
      });
    }
  }

  let time = 0;
  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Soft gradient ground
    const grd = ctx.createLinearGradient(0, h * 0.7, 0, h);
    grd.addColorStop(0, 'rgba(120,170,100,0)');
    grd.addColorStop(0.4, 'rgba(120,170,100,0.03)');
    grd.addColorStop(1, 'rgba(100,155,80,0.08)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);

    // Draw blades
    for (const b of blades) {
      const sway = Math.sin(time * b.speed + b.phase) * b.amplitude;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x, b.baseY);
      // Quadratic curve for natural bend
      ctx.quadraticCurveTo(
        b.x + sway * 0.6, b.baseY - b.height * 0.5,
        b.x + sway, b.baseY - b.height
      );
      ctx.stroke();
      ctx.restore();
    }
    time += 0.016;
    grassAnimId = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}

// On load: handle admin mode for local (no-Firebase) mode
loadData(()=>{
  renderAll();
  renderAuthBar();
  if(!firebaseReady && isAdmin()){
    document.body.classList.add('admin-mode');
    initGrass();
  }
  // Auto-fill missing weather from historical data
  autoFillWeather();
});

// Lazy-load Spotify embeds + position hover cards within viewport
document.addEventListener('mouseover',function(e){
  const chip=e.target.closest('.player-chip');
  if(!chip)return;
  // Spotify lazy load
  const song=chip.querySelector('.pc-hover-song[data-spotify]');
  if(song){
    const id=song.dataset.spotify;
    delete song.dataset.spotify;
    song.innerHTML=`<iframe style="border-radius:0" src="https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0" width="100%" height="152" frameBorder="0" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }
  // Position hover card within viewport
  const hover=chip.querySelector('.pc-hover');
  if(!hover)return;
  const cr=chip.getBoundingClientRect();
  const buf=12;
  // Default: centered above the chip
  let left=cr.left+cr.width/2-160;
  let top=cr.top-8;
  // Measure after making visible briefly
  hover.style.visibility='hidden';hover.style.display='block';
  const hr=hover.getBoundingClientRect();
  hover.style.display='';hover.style.visibility='';
  const hW=hr.width||320;
  const hH=hr.height||200;
  // Horizontal: clamp within viewport
  left=Math.max(buf,Math.min(left,window.innerWidth-hW-buf));
  // Vertical: show above chip, or below if not enough space above
  top=cr.top-hH-8;
  if(top<buf) top=cr.bottom+8;
  hover.style.left=left+'px';
  hover.style.top=top+'px';
});

// Teaser banner: animated collapse/expand on scroll
(function(){
  let collapsed = false;
  let animating = false;
  const collapseAt = 60;
  const dur = 280;

  window.addEventListener('scroll', function(){
    if(animating) return;
    const banner = document.getElementById('teaserBanner');
    if(!banner || !banner.classList.contains('active')) return;
    const inner = document.getElementById('teaserInner');
    const col = document.getElementById('teaserCollapsed');
    const y = window.scrollY;

    if(!collapsed && y > collapseAt){
      // Collapse: lock current height, add class, animate to collapsed height
      animating = true;
      const hFrom = inner.offsetHeight;
      inner.style.height = hFrom + 'px';
      banner.classList.add('collapsed');
      banner.classList.remove('settled');
      const hTo = col.offsetHeight;
      inner.offsetHeight; // reflow
      inner.style.height = hTo + 'px';
      setTimeout(function(){
        // Keep explicit height — collapsed bar is absolute so nothing else sizes the container
        banner.classList.add('settled');
        animating = false;
      }, dur);
      collapsed = true;

    } else if(collapsed && y <= 0){
      // Expand: lock collapsed height, remove class, animate to full height
      animating = true;
      const hFrom = col.offsetHeight;
      inner.style.height = hFrom + 'px';
      banner.classList.remove('collapsed','settled');
      const full = document.getElementById('teaserFull');
      const hTo = full.offsetHeight;
      inner.offsetHeight; // reflow
      inner.style.height = hTo + 'px';
      setTimeout(function(){
        inner.style.height = '';
        animating = false;
      }, dur);
      collapsed = false;
    }
  }, {passive:true});
})();
