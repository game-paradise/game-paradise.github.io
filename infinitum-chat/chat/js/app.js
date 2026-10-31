import { auth, db, googleProvider } from './firebase.js';
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, signOut
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy,
  limit, onSnapshot, serverTimestamp, writeBatch, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';

/* =====================  helpers  ===================== */
const $ = (sel, root = document) => root.querySelector(sel);

// Kleine DOM-bouwer. Tekst gaat altijd via textContent (geen XSS); `html` alleen voor eigen iconen.
function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props.nodeType || Array.isArray(props)) {
    kids.unshift(props); props = {};
  }
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  send: '<svg viewBox="0 0 24 24"><path d="M3.2 11.4 20.4 3.3c.9-.4 1.7.5 1.3 1.3L13.6 21.8c-.4.9-1.7.8-1.9-.2l-1.6-6.5L3.5 13.3c-1-.2-1.2-1.5-.3-1.9z" fill="url(#gradSend)"/></svg>',
  logout: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')
};

function hash(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
const PROF = {};   // uid -> profieldata (live voor vrienden, eenmalig opgehaald voor anderen)
// alleen echte jpeg-data-urls of hex-kleuren komen ooit in CSS terecht
const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, HEX_RE = /^#[0-9a-fA-F]{6}$/;
const safeImg = (s) => (typeof s === 'string' && IMG_RE.test(s)) ? s : '';
const safeBanner = (s) => (typeof s === 'string' && (HEX_RE.test(s) || IMG_RE.test(s))) ? s : '';
const gradFor = (id) => { const hu = hash(id) % 360; return `linear-gradient(135deg,hsl(${hu} 80% 62%),hsl(${(hu + 70) % 360} 80% 52%))`; };
const letterOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
function paintAvatar(el) {
  const src = el.dataset.uid && safeImg(PROF[el.dataset.uid]?.avatar);
  if (src) { el.style.background = `center / cover no-repeat url("${src}")`; el.textContent = ''; }
  else { el.style.background = gradFor(el.dataset.gid); el.textContent = el.dataset.ch; }
}
// isUser = true: toont de profielfoto (als die er is) en opent bij klikken het profiel
function avatar(id, name, size = 40, isUser = false) {
  const el = h('span', { class: 'avatar', style: `--s:${size}px`, 'data-gid': id, 'data-ch': letterOf(name), 'data-uid': isUser ? id : null });
  paintAvatar(el);
  return el;
}
let avRaf = 0;
function refreshAvatars() {
  cancelAnimationFrame(avRaf);
  avRaf = requestAnimationFrame(() => document.querySelectorAll('.avatar[data-gid]').forEach(paintAvatar));
}
function loadProfiles(uids) {
  for (const u of new Set(uids)) {
    if (!u || u in PROF) continue;
    PROF[u] = null;
    getDoc(doc(db, 'users', u)).then(s => { PROF[u] = s.exists() ? s.data() : null; onProfChange(u); }).catch(() => {});
  }
}

// avatar met presence-bolletje; de kleur wordt live bijgewerkt door renderPresence()
function dotted(uid, name, size = 40) {
  const d = h('i', { class: 'dot', 'data-uid': uid });
  setDot(d);
  return h('span', { class: 'av-wrap', style: `--s:${size}px` }, avatar(uid, name, size, true), d);
}

const tf = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function dayLabel(d) {
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return 'Vandaag';
  if (dayKey(d) === dayKey(new Date(now - 864e5))) return 'Gisteren';
  return df.format(d);
}

function toast(text) {
  const t = h('div', { class: 'toast', text });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}

function fbErr(e) {
  const c = e?.code || '';
  if (c.includes('permission-denied')) return 'Firestore weigert toegang (permission-denied). Plak de inhoud van firestore.rules bij Firestore → Regels en klik op Publiceren.';
  if (c.includes('not-found')) return 'Je Firestore-database bestaat nog niet (not-found). Maak hem aan in de Firebase Console: Build → Firestore Database → Database maken.';
  if (c.includes('unavailable')) return 'Geen verbinding met Firebase.';
  return (e?.message || 'Er ging iets mis.') + (c ? ` (${c})` : '');
}
function authErr(e) {
  switch (e?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Onjuiste e-mail of wachtwoord.';
    case 'auth/email-already-in-use': return 'Dit e-mailadres is al in gebruik.';
    case 'auth/weak-password': return 'Kies een wachtwoord van minimaal 6 tekens.';
    case 'auth/invalid-email': return 'Dit e-mailadres klopt niet.';
    case 'auth/too-many-requests': return 'Te veel pogingen. Probeer het later opnieuw.';
    case 'auth/operation-not-allowed': return 'Deze inlogmethode staat nog uit in de Firebase Console (Authentication → Sign-in method).';
    case 'auth/unauthorized-domain': return `Het domein "${location.hostname}" staat niet bij de toegestane domeinen. Open de site via localhost, of voeg dit domein toe in Firebase Console → Authentication → Instellingen → Geautoriseerde domeinen.`;
    case 'auth/network-request-failed': return 'Netwerkfout — controleer je internetverbinding.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return '';
    default: return fbErr(e);
  }
}

/* =====================  state  ===================== */
const S = {
  me: null, profile: null, tab: 'dms',
  friendships: [], meta: {}, metaUnsub: {},
  servers: [], activeDm: null, activeServer: null,
  chat: null, unsub: {}, pendingName: null, started: false,
  metaSeen: {}, reqSeen: null
};

/* typ-indicator: staat aan tenzij config/features.typingIndicators op false staat */
const TY = { enabled: true, ttl: 6000, every: 3000 };
/* leesbewijzen: aan tenzij config/features.readReceipts op false staat EN jij ze niet zelf uitzet (Instellingen -> Privacy) */
const RR = { enabled: true, every: 3000 };

const pairId = (a, b) => [a, b].sort().join('_');
const accepted = () => S.friendships.filter(f => f.status === 'accepted');
const incoming = () => S.friendships.filter(f => f.status === 'pending' && f.requester !== S.me.uid);
const outgoing = () => S.friendships.filter(f => f.status === 'pending' && f.requester === S.me.uid);
const otherId = (f) => f.users.find(u => u !== S.me.uid);
const otherName = (f) => PROF[otherId(f)]?.username || (f.names && f.names[otherId(f)]) || 'Onbekend';
const dmInfo = (id) => { const f = accepted().find(x => x.id === id); return f ? { uid: otherId(f), name: otherName(f) } : null; };
const serverInfo = (id) => S.servers.find(s => s.id === id) || null;
const setView = (v) => { $('#app').dataset.view = v; };

/* =====================  inloggen  ===================== */
let mode = 'login';
function setMode(m) {
  mode = m;
  document.querySelectorAll('#authSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#userField').hidden = m !== 'signup';
  $('#aSubmit').textContent = m === 'signup' ? 'Account maken' : 'Inloggen';
  $('#aPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#aErr').textContent = '';
}
$('#authSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
$('#logoutBtn').innerHTML = I.logout;

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#aErr'), btn = $('#aSubmit');
  err.textContent = '';
  const email = $('#aMail').value.trim(), pass = $('#aPass').value;
  if (!email || !pass) { err.textContent = 'Vul je e-mail en wachtwoord in.'; return; }
  btn.disabled = true;
  try {
    if (mode === 'signup') {
      const name = $('#aUser').value.trim();
      if (!/^[A-Za-z0-9_.]{2,20}$/.test(name)) throw { code: 'x', message: 'Gebruikersnaam: 2–20 tekens, alleen letters, cijfers, _ en .' };
      try {
        const taken = await getDoc(doc(db, 'usernames', name.toLowerCase()));
        if (taken.exists()) throw { code: 'x', message: 'Deze gebruikersnaam is al bezet.' };
      } catch (pre) {
        if (pre.code === 'x') throw pre;
        console.warn('Gebruikersnaam-check overgeslagen:', pre); // Firestore-problemen worden hierna netjes gemeld
      }
      S.pendingName = { email: email.toLowerCase(), name };
      await createUserWithEmailAndPassword(auth, email, pass);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (ex) {
    S.pendingName = null;
    err.textContent = ex.code === 'x' ? ex.message : authErr(ex);
  } finally { btn.disabled = false; }
});

$('#aGoogle').addEventListener('click', async () => {
  $('#aErr').textContent = '';
  try { await signInWithPopup(auth, googleProvider); }
  catch (ex) {
    if (ex.code === 'auth/popup-blocked') {
      try { await signInWithRedirect(auth, googleProvider); return; } catch (e2) { ex = e2; }
    }
    console.error(ex);
    $('#aErr').textContent = authErr(ex);
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  await Promise.race([presenceGoOffline(), new Promise(r => setTimeout(r, 1500))]); // meteen offline tonen
  signOut(auth);
});

// Maakt (atomair) profiel + unieke gebruikersnaam aan bij de eerste keer.
async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  if ((await getDoc(ref)).exists()) return;

  const pend = S.pendingName && S.pendingName.email === (user.email || '').toLowerCase() ? S.pendingName.name : null;
  let base = (pend || user.displayName || (user.email || 'user').split('@')[0] || 'user')
    .replace(/[^A-Za-z0-9_.]/g, '').slice(0, 16);
  if (base.length < 2) base = 'user' + Math.floor(Math.random() * 90 + 10);

  let name = base;
  for (let i = 0; i < 8; i++) {
    const lower = name.toLowerCase();
    if ((await getDoc(doc(db, 'usernames', lower))).exists()) {
      name = base.slice(0, 15) + Math.floor(Math.random() * 900 + 100);
      continue;
    }
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', lower), { uid: user.uid });
    batch.set(ref, { username: name, usernameLower: lower, status: '', createdAt: serverTimestamp() });
    await batch.commit(); // echte fouten (regels / database ontbreekt) komen hier naar boven
    S.pendingName = null;
    if (pend && name.toLowerCase() !== pend.toLowerCase()) toast(`"${pend}" was al bezet — je bent ${name} geworden.`);
    return;
  }
  throw new Error('Kon geen vrije gebruikersnaam vinden.');
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    teardown();
    $('#app').hidden = true; $('#auth').hidden = false;
    return;
  }
  if (S.started && S.me?.uid === user.uid) return;
  S.me = user;
  try { await ensureProfile(user); }
  catch (e) {
    console.error(e);
    $('#aErr').textContent = fbErr(e);
    await signOut(auth);
    return;
  }
  S.started = true;
  startListeners();
  $('#auth').hidden = true; $('#app').hidden = false;
  setTab('dms');
});

/* =====================  realtime  ===================== */
function startListeners() {
  const uid = S.me.uid;
  S.unsub.profile = onSnapshot(doc(db, 'users', uid), s => { S.profile = s.data() || null; PROF[uid] = S.profile; renderUserCard(); refreshAvatars(); },
    e => console.error(e));

  S.unsub.friends = onSnapshot(query(collection(db, 'friendships'), where('users', 'array-contains', uid)), snap => {
    S.friendships = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    syncChatMeta(); scheduleWatch(); checkNewRequests();
    renderTabs(); scheduleSidebar();
    if (S.tab === 'friends') renderFriendList();
    if (S.tab === 'requests') renderRequestLists();
    if (S.tab === 'dms') {
      if (S.activeDm && !dmInfo(S.activeDm)) { S.activeDm = null; showMain(); }
    }
  }, e => { console.error(e); toast(fbErr(e)); });

  S.unsub.servers = onSnapshot(query(collection(db, 'servers'), where('members', 'array-contains', uid)), snap => {
    S.servers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    scheduleSidebar(); scheduleWatch();
    if (S.activeServer && !serverInfo(S.activeServer)) {
      S.activeServer = null;
      if (S.tab === 'servers') showMain();
    } else if (S.chat?.type === 'server') {
      const old = $('#chatHead');
      if (old && serverInfo(S.chat.id)) old.replaceWith(buildHead('server', S.chat.id));
    }
  }, e => { console.error(e); toast(fbErr(e)); });

  // noodschakelaar: Firestore -> config -> features -> typingIndicators (true/false)
  S.unsub.config = onSnapshot(doc(db, 'config', 'features'), s => {
    TY.enabled = s.exists() ? s.data().typingIndicators !== false : true;
    RR.enabled = s.exists() ? s.data().readReceipts !== false : true;
    if (S.chat) { TY.enabled ? startTypingWatch() : stopTypingWatch(); renderTyping(); syncReadWatch(); }
  }, () => { TY.enabled = false; RR.enabled = false; stopTypingWatch(); renderTyping(); syncReadWatch(); });

  startPresence();
}

function syncChatMeta() {
  const ids = new Set(accepted().map(f => f.id));
  for (const id of Object.keys(S.metaUnsub)) {
    if (!ids.has(id)) { S.metaUnsub[id](); delete S.metaUnsub[id]; delete S.meta[id]; delete S.metaSeen[id]; }
  }
  for (const id of ids) {
    if (S.metaUnsub[id]) continue;
    S.metaUnsub[id] = onSnapshot(doc(db, 'chats', id), s => {
      const prev = S.meta[id], cur = s.data() || null;
      S.meta[id] = cur;
      // nieuw bericht van de ander (niet bij het eerste laden, niet als je dat gesprek open hebt)
      if (S.metaSeen[id] && cur && !s.metadata.hasPendingWrites && cur.lastUid && cur.lastUid !== S.me?.uid) {
        const before = prev?.lastAt?.toMillis?.() || 0, now = cur.lastAt?.toMillis?.() || 0;
        const open = S.tab === 'dms' && S.activeDm === id && isVisible();
        if (now > before && !open) {
          const f = accepted().find(x => x.id === id);
          notify('dm', f ? otherName(f) : 'Nieuw bericht', cur.lastText || '', () => {
            S.activeDm = id; S.tab = 'dms'; renderTabs(); renderSidebar(); showMain();
          });
        }
      }
      S.metaSeen[id] = true;
      scheduleSidebar();
    }, () => {});
  }
}

function unsubChat() { stopTypingWatch(); stopReadWatch(); clearTimeout(S.chat?.typeT); S.unsub.chat?.(); S.unsub.chat = null; S.chat = null; scheduleWatch(); }
function teardown() {
  stopPresence();
  unsubChat();
  for (const k of ['profile', 'friends', 'servers', 'config']) { S.unsub[k]?.(); S.unsub[k] = null; }
  Object.values(S.metaUnsub).forEach(u => u());
  Object.assign(S, { me: null, profile: null, friendships: [], meta: {}, metaUnsub: {}, servers: [], activeDm: null, activeServer: null, started: false, tab: 'dms', metaSeen: {}, reqSeen: null });
  for (const k of Object.keys(PROF)) delete PROF[k];
  $('#main').replaceChildren(); $('#sideList').replaceChildren(); $('#sideFoot').replaceChildren();
}

/* =====================  tabs + zijbalk  ===================== */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });

function setTab(t) { S.tab = t; renderTabs(); renderSidebar(); showMain(); }

function renderTabs() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const n = S.me ? incoming().length : 0;
  const bd = $('#reqBadge'); bd.hidden = !n; bd.textContent = n;
  $('#settingsBtn').classList.toggle('active', S.tab === 'settings');
}

function renderUserCard() {
  const p = S.profile;
  $('#meAvatar').replaceChildren(dotted(S.me.uid, p?.username, 46));
  $('#meName').textContent = p?.username || '…';
}

let sideRaf = 0;
function scheduleSidebar() { cancelAnimationFrame(sideRaf); sideRaf = requestAnimationFrame(renderSidebar); }

function renderSidebar() {
  if (!S.me) return;
  const list = $('#sideList'), foot = $('#sideFoot');
  list.replaceChildren(); foot.replaceChildren();

  if (S.tab === 'servers') {
    $('#sideTitle').textContent = 'Servers';
    if (!S.servers.length) list.append(h('p', { class: 'hint', text: 'Je zit nog in geen enkele server. Maak er een of join met een code.' }));
    for (const s of [...S.servers].sort((a, b) => a.name.localeCompare(b.name))) {
      list.append(h('button', {
        class: 'item' + (S.activeServer === s.id ? ' active' : ''),
        onclick: () => { S.activeServer = s.id; renderSidebar(); showMain(); }
      },
        avatar(s.id, s.name, 42),
        h('span', { class: 'item-text' }, h('b', { text: s.name }), h('small', { text: `${s.members.length} ${s.members.length === 1 ? 'lid' : 'leden'}` }))));
    }
    foot.append(
      h('button', { class: 'glow', type: 'button', onclick: openCreateServer, html: I.plus + 'Server maken' }),
      h('button', { class: 'ghost', type: 'button', onclick: openJoinServer, text: 'Joinen met code' }));
    return;
  }

  $('#sideTitle').textContent = 'Directe berichten';
  const when = (f) => S.meta[f.id]?.lastAt?.toMillis?.() || 0;
  const friends = [...accepted()].sort((a, b) => when(b) - when(a) || otherName(a).localeCompare(otherName(b)));
  if (!friends.length) list.append(h('p', { class: 'hint', text: 'Nog geen vrienden. Voeg iemand toe via het tabblad Friends.' }));
  for (const f of friends) {
    const m = S.meta[f.id];
    const preview = m?.lastText ? (m.lastUid === S.me.uid ? 'Jij: ' : '') + m.lastText : 'Begin een gesprek';
    list.append(h('button', {
      class: 'item' + (S.activeDm === f.id && S.tab === 'dms' ? ' active' : ''),
      onclick: () => { S.activeDm = f.id; if (S.tab !== 'dms') { S.tab = 'dms'; renderTabs(); } renderSidebar(); showMain(); }
    },
      dotted(otherId(f), otherName(f), 42),
      h('span', { class: 'item-text' }, h('b', { text: otherName(f) }), h('small', { text: preview })),
      pbadge(otherId(f))));
  }
}

/* =====================  hoofdvlak  ===================== */
function showMain() {
  unsubChat();
  if (S.tab === 'friends') { renderFriends(); setView('main'); return; }
  if (S.tab === 'requests') { renderRequests(); setView('main'); return; }
  if (S.tab === 'settings') { renderSettings(); setView('main'); return; }
  const type = S.tab === 'dms' ? 'dm' : 'server';
  const id = type === 'dm' ? S.activeDm : S.activeServer;
  if (id && (type === 'dm' ? dmInfo(id) : serverInfo(id))) { openChat(type, id); setView('main'); }
  else { renderEmpty(type); setView('list'); }
}

function renderEmpty(type) {
  $('#main').replaceChildren(h('div', { class: 'empty' },
    h('img', { src: 'assets/infinitum-logo.svg', alt: '' }),
    h('h2', { text: type === 'dm' ? 'Kies een gesprek' : 'Kies een server' }),
    h('p', { text: type === 'dm' ? 'Selecteer een vriend links om te chatten.' : 'Selecteer een server links, of maak er zelf een.' })));
}

function buildHead(type, id) {
  const back = h('button', {
    class: 'icon-btn back', type: 'button', html: I.back, 'aria-label': 'Terug',
    onclick: () => { if (type === 'dm') S.activeDm = null; else S.activeServer = null; renderSidebar(); showMain(); }
  });
  const head = h('div', { class: 'chat-head', id: 'chatHead' }, back);

  if (type === 'dm') {
    const i = dmInfo(id);
    head.append(dotted(i.uid, i.name, 42), h('div', { class: 'grow' }, h('h2', { text: i.name }), h('small', { id: 'peerStatus' })));
    getDoc(doc(db, 'users', i.uid)).then(s => {
      const el = $('#peerStatus'); if (el && s.exists()) { el.dataset.st = s.data().status || ''; renderPresence(); }
    }).catch(() => {});
  } else {
    const s = serverInfo(id), owner = s.ownerId === S.me.uid;
    head.append(
      avatar(id, s.name, 42),
      h('div', { class: 'grow' }, h('h2', { text: s.name }), h('small', { id: 'srvMeta', text: srvMetaText(s) })),
      h('button', { class: 'ghost sm', type: 'button', onclick: openMembers, text: 'Leden' }),
      h('button', {
        class: 'ghost sm', type: 'button', html: I.copy + '<span>Uitnodigingscode</span>',
        onclick: async () => { try { await navigator.clipboard.writeText(id); toast('Code gekopieerd — deel hem met vrienden.'); } catch { toast('Code: ' + id); } }
      }),
      h('button', {
        class: 'icon-btn', type: 'button', html: owner ? I.trash : I.logout,
        title: owner ? 'Server verwijderen' : 'Server verlaten', 'aria-label': owner ? 'Server verwijderen' : 'Server verlaten',
        onclick: () => owner ? deleteServer(s) : leaveServer(s)
      }));
  }
  return head;
}

function openChat(type, id) {
  unsubChat();
  const col = type === 'dm' ? collection(db, 'chats', id, 'messages') : collection(db, 'servers', id, 'messages');
  S.chat = { type, id, col, first: true, seen: {}, lastPing: 0, lastId: null, reads: {}, newest: null, markedId: null, lastRead: 0, lastMineAt: 0 };
  const name = type === 'dm' ? dmInfo(id).name : serverInfo(id).name;

  const ta = h('textarea', { id: 'msgInput', rows: 1, maxlength: 2000, placeholder: type === 'dm' ? `Bericht aan ${name}` : `Bericht in ${name}` });
  const doSend = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; ta.style.height = 'auto';
    try { await sendMessage(text); }
    catch (e) { ta.value = text; toast(fbErr(e)); }
  };
  ta.addEventListener('input', () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    if (ta.value.trim()) pingTyping();
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });

  $('#main').replaceChildren(
    buildHead(type, id),
    h('div', { class: 'msgs', id: 'msgList' }),
    h('div', { class: 'typing', id: 'typingBar', 'aria-live': 'polite' }),
    h('div', { class: 'composer' },
      h('div', { class: 'box' }, ta),
      h('button', { class: 'glow send', type: 'button', title: 'Versturen', 'aria-label': 'Versturen', html: I.send, onclick: doSend })));

  let primed = false;
  S.unsub.chat = onSnapshot(query(col, orderBy('createdAt', 'desc'), limit(100)), snap => {
    // servermeldingen: alleen voor de server die open staat terwijl je tabblad op de achtergrond is
    if (primed && type === 'server' && !snap.metadata.hasPendingWrites && !(isVisible() && document.hasFocus())) {
      for (const ch of snap.docChanges()) {
        const m = ch.type === 'added' ? ch.doc.data({ serverTimestamps: 'estimate' }) : null;
        if (m && m.uid !== S.me.uid) notify('server', `${m.name || 'Onbekend'} in ${name}`, m.text, () => {});
      }
    }
    primed = true;
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse();
    renderMessages(msgs);
  }, e => { console.error(e); toast(fbErr(e)); });

  if (matchMedia('(min-width: 801px)').matches) ta.focus();
  scheduleWatch(); renderPresence();
  startTypingWatch();
  syncReadWatch();
}

/* =====================  leesbewijzen  ===================== */
// Per gesprek: <chat of server>/reads/<uid> met { at } = het moment waarop jij voor het laatst alles las.
// Eén schrijfactie per 3 s, alleen als er iets nieuws van een ander is en het tabblad open + actief is.
// Een bericht is gelezen door iemand als diens `at` na het bericht ligt. Het oogje staat onder je laatste bericht.
function startReadWatch() {
  const c = S.chat;
  if (!rrOn() || !c || c.readUnsub) return;
  c.readsCol = collection(c.col.parent, 'reads');
  c.readUnsub = onSnapshot(c.readsCol, snap => {
    if (S.chat !== c) return;
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') { delete c.reads[ch.doc.id]; continue; }
      c.reads[ch.doc.id] = ch.doc.data({ serverTimestamps: 'estimate' }).at?.toMillis?.() || 0;
    }
    updateReceipt();
  }, () => {});
}

function stopReadWatch() {
  const c = S.chat;
  if (!c) return;
  clearTimeout(c.readT);
  c.readUnsub?.(); c.readUnsub = null;
  c.reads = {};
}

function syncReadWatch() {
  if (!S.chat) return;
  if (rrOn()) { startReadWatch(); markRead(); } else stopReadWatch();
  updateReceipt();
}

function markRead() {
  const c = S.chat;
  if (!rrOn() || !c?.readsCol || !c.newest || c.newest.uid === S.me.uid || c.markedId === c.newest.id) return;
  if (!isVisible() || !document.hasFocus() || activeManual() === 'invisible') return;
  clearTimeout(c.readT);
  const wait = c.lastRead + RR.every - Date.now();
  if (wait > 0) { c.readT = setTimeout(markRead, wait); return; }
  c.markedId = c.newest.id; c.lastRead = Date.now();
  setDoc(doc(c.readsCol, S.me.uid), { at: serverTimestamp() }).catch(() => { if (S.chat === c) c.markedId = null; });
}
window.addEventListener('focus', () => markRead());
document.addEventListener('visibilitychange', () => markRead());

function updateReceipt() {
  const el = $('#receipt'), c = S.chat;
  if (!el || !c) return;
  el.replaceChildren();
  if (!rrOn() || !c.lastMineAt) return;
  const allowed = new Set(c.type === 'dm' ? [dmInfo(c.id)?.uid] : (serverInfo(c.id)?.members || []));
  const readers = Object.entries(c.reads).filter(([u, at]) => u !== S.me.uid && allowed.has(u) && at >= c.lastMineAt).map(([u]) => u);
  if (!readers.length) return;
  const names = readers.map(u => PROF[u]?.username).filter(Boolean).slice(0, 10).join(', ');
  el.append(h('span', {
    class: 'rcpt', title: names ? 'Gelezen door ' + names : 'Gelezen',
    'aria-label': c.type === 'server' ? `Gelezen door ${readers.length}` : 'Gelezen'
  }, h('span', { class: 'rcpt-ic', html: I.eye }), c.type === 'server' ? h('b', { text: String(readers.length) }) : null));
}

/* =====================  typ-indicator  ===================== */
// Per gesprek: <chat of server>/typing/<uid> met { at }. Eén schrijfactie per 3 s zolang je typt,
// niets bij stoppen of versturen (de indicator verloopt vanzelf na 6 s of zodra er een bericht komt).
function pingTyping() {
  const c = S.chat;
  if (!TY.enabled || !c?.typingCol || activeManual() === 'invisible') return;
  const now = Date.now();
  if (now - c.lastPing < TY.every) return;
  c.lastPing = now;
  setDoc(doc(c.typingCol, S.me.uid), { at: serverTimestamp() }).catch(() => {});
}

function startTypingWatch() {
  const c = S.chat;
  if (!TY.enabled || !c || c.typingUnsub) return;
  c.typingCol = collection(c.col.parent, 'typing');
  let primed = false;
  c.typingUnsub = onSnapshot(c.typingCol, snap => {
    if (S.chat !== c) return;
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed' || ch.doc.id === S.me.uid || ch.doc.metadata.hasPendingWrites) continue;
      const at = ch.doc.data({ serverTimestamps: 'estimate' }).at?.toMillis?.() || 0;
      if (!primed && Date.now() - at > TY.ttl) continue;   // oud document bij het openen
      c.seen[ch.doc.id] = Date.now();
      loadProfiles([ch.doc.id]);
    }
    primed = true;
    renderTyping();
  }, () => {});
}

function stopTypingWatch() {
  const c = S.chat;
  if (!c) return;
  c.typingUnsub?.(); c.typingUnsub = null;
  c.seen = {};
}

function renderTyping() {
  const el = $('#typingBar'), c = S.chat;
  if (!el || !c) return;
  clearTimeout(c.typeT);
  const now = Date.now(), names = [];
  let next = Infinity;
  if (TY.enabled) {
    for (const [u, t] of Object.entries(c.seen)) {
      const left = t + TY.ttl - now;
      if (left <= 0) { delete c.seen[u]; continue; }
      next = Math.min(next, left);
      names.push(PROF[u]?.username || 'Iemand');
    }
  }
  if (!names.length) { el.replaceChildren(); return; }
  const text = names.length === 1 ? `${names[0]} is aan het typen…`
    : names.length === 2 ? `${names[0]} en ${names[1]} zijn aan het typen…`
    : 'Meerdere mensen zijn aan het typen…';
  el.replaceChildren(h('span', { class: 'tdots' }, h('i'), h('i'), h('i')), h('span', { text }));
  c.typeT = setTimeout(renderTyping, next + 50);
}

/* Typen buiten de typbalk: de balk blijft met rust gelaten als je ernaast klikt,
   maar zodra je begint te typen springt de cursor automatisch terug in de chatbalk.
   Niet als je al in een ander invoerveld zit (status, zoeken, dialoog, enz.). */
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing) return;
  const ta = $('#msgInput');
  if (!S.chat || !ta || !ta.isConnected || $('#app').hidden) return;
  if (document.activeElement === ta) return;
  if (document.querySelector('dialog[open]')) return;

  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;

  const paste = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v';
  const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!paste && !typing) return;
  // spatie activeert een knop die focus heeft; die niet afpakken
  if (e.key === ' ' && a && /^(BUTTON|A|SUMMARY)$/.test(a.tagName)) return;

  ta.focus(); // geen preventDefault: het teken landt hierna vanzelf in de balk
});

function renderMessages(msgs) {
  const list = $('#msgList'); if (!list || !S.chat) return;
  const nearBottom = S.chat.first || list.scrollHeight - list.scrollTop - list.clientHeight < 140;
  loadProfiles(msgs.map(m => m.uid));
  list.replaceChildren();
  if (!msgs.length) list.append(h('p', { class: 'start', text: 'Dit is het begin van jullie gesprek. Zeg hallo! 👋' }));

  const lastMine = [...msgs].reverse().find(x => x.uid === S.me.uid);
  let prev = null;
  for (const m of msgs) {
    const d = m.createdAt?.toDate?.() || new Date();
    const newDay = !prev || dayKey(prev.d) !== dayKey(d);
    if (newDay) list.append(h('div', { class: 'day', text: dayLabel(d) }));
    const grouped = !newDay && prev.uid === m.uid && d - prev.d < 5 * 60000;
    const mine = m.uid === S.me.uid;
    list.append(h('div', { class: `msg ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}` },
      mine && h('button', { class: 'icon-btn del', type: 'button', title: 'Verwijderen', 'aria-label': 'Bericht verwijderen', html: I.trash, onclick: () => deleteMessage(m.id) }),
      !mine && h('div', { class: 'msg-av' }, grouped ? null : avatar(m.uid, PROF[m.uid]?.username || m.name, 34, true)),
      h('div', { class: 'msg-body' },
        !grouped && h('div', { class: 'meta' }, !mine && h('b', { text: PROF[m.uid]?.username || m.name || 'Onbekend' }), h('time', { text: tf.format(d) })),
        h('div', { class: 'bubble', text: m.text }),
        lastMine && m.id === lastMine.id ? h('div', { class: 'receipt', id: 'receipt' }) : null)));
    prev = { uid: m.uid, d };
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
  S.chat.first = false;

  const last = msgs[msgs.length - 1];
  S.chat.newest = last ? { id: last.id, uid: last.uid } : null;
  S.chat.lastMineAt = lastMine?.createdAt?.toMillis?.() || 0;
  markRead(); updateReceipt();
  if (last && last.id !== S.chat.lastId) {
    if (S.chat.lastId && last.uid !== S.me.uid) delete S.chat.seen[last.uid];
    S.chat.lastId = last.id;
    renderTyping();
  }
}

async function sendMessage(text) {
  const c = S.chat; if (!c) return;
  const batch = writeBatch(db);
  batch.set(doc(c.col), { uid: S.me.uid, name: S.profile?.username || 'Onbekend', text, createdAt: serverTimestamp() });
  if (c.type === 'dm') {
    batch.set(doc(db, 'chats', c.id), { lastText: text.slice(0, 80), lastUid: S.me.uid, lastAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

async function deleteMessage(id) {
  try { await deleteDoc(doc(S.chat.col, id)); } catch (e) { toast(fbErr(e)); }
}

/* =====================  vrienden  ===================== */
async function addFriend(raw) {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_.]{2,20}$/.test(name)) return { ok: false, text: 'Dat is geen geldige gebruikersnaam.' };
  const lower = name.toLowerCase();
  if (lower === S.profile?.usernameLower) return { ok: false, text: 'Jezelf toevoegen gaat helaas niet 😄' };
  try {
    const u = await getDoc(doc(db, 'usernames', lower));
    if (!u.exists()) return { ok: false, text: 'Geen gebruiker gevonden met die naam.' };
    const other = u.data().uid;
    const prof = await getDoc(doc(db, 'users', other));
    if (!prof.exists()) return { ok: false, text: 'Geen gebruiker gevonden met die naam.' };
    const id = pairId(S.me.uid, other);
    const ex = S.friendships.find(f => f.id === id);
    if (ex?.status === 'accepted') return { ok: false, text: 'Jullie zijn al vrienden.' };
    if (ex) return { ok: false, text: ex.requester === S.me.uid ? 'Je hebt al een verzoek gestuurd.' : 'Die persoon heeft jou al een verzoek gestuurd — kijk bij Requests.' };
    const [a, b] = [S.me.uid, other].sort();
    await setDoc(doc(db, 'friendships', id), {
      users: [a, b], requester: S.me.uid, status: 'pending',
      names: { [S.me.uid]: S.profile.username, [other]: prof.data().username },
      createdAt: serverTimestamp()
    });
    return { ok: true, text: `Verzoek verstuurd naar ${prof.data().username}!` };
  } catch (e) { return { ok: false, text: fbErr(e) }; }
}

function renderFriends() {
  const inp = h('input', { class: 'inp', id: 'addInp', maxlength: 20, placeholder: 'Gebruikersnaam toevoegen…', autocomplete: 'off' });
  const msg = h('p', { class: 'note' });
  const go = async () => {
    msg.className = 'note'; msg.textContent = '';
    const r = await addFriend(inp.value);
    msg.textContent = r.text; msg.className = 'note ' + (r.ok ? 'ok' : 'bad');
    if (r.ok) inp.value = '';
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#main').replaceChildren(h('div', { class: 'pane' },
    h('h2', { text: 'Vrienden' }),
    h('p', { class: 'sub', text: 'Voeg iemand toe met zijn of haar gebruikersnaam.' }),
    h('div', { class: 'addrow' }, inp, h('button', { class: 'glow', type: 'button', onclick: go, text: 'Verzoek sturen' })),
    msg,
    h('h3', { class: 'sec', id: 'friendCount' }),
    h('div', { id: 'friendList' })));
  renderFriendList();
}

function renderFriendList() {
  const box = $('#friendList'); if (!box) return;
  const fr = [...accepted()].sort((a, b) => otherName(a).localeCompare(otherName(b)));
  $('#friendCount').textContent = `Alle vrienden — ${fr.length}`;
  box.replaceChildren(...(fr.length ? fr.map(f => h('div', { class: 'row' },
    dotted(otherId(f), otherName(f), 42),
    h('span', { class: 'item-text' }, h('b', { text: otherName(f) }),
      h('small', { class: 'plabel', 'data-uid': otherId(f), text: LABEL[presState(otherId(f))] })),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn-ok', type: 'button', text: 'Bericht',
        onclick: () => { S.activeDm = f.id; S.tab = 'dms'; renderTabs(); renderSidebar(); showMain(); }
      }),
      h('button', {
        class: 'icon-btn', type: 'button', html: I.trash, title: 'Verwijderen', 'aria-label': 'Vriend verwijderen',
        onclick: async () => {
          if (!confirm(`${otherName(f)} verwijderen als vriend?`)) return;
          try { await deleteDoc(doc(db, 'friendships', f.id)); } catch (e) { toast(fbErr(e)); }
        }
      })))) : [h('p', { class: 'hint', text: 'Nog geen vrienden — stuur hierboven een verzoek.' })]));
}

function renderRequests() {
  $('#main').replaceChildren(h('div', { class: 'pane' },
    h('h2', { text: 'Verzoeken' }),
    h('p', { class: 'sub', text: 'Vriendschapsverzoeken die je hebt ontvangen of verstuurd.' }),
    h('h3', { class: 'sec', id: 'inCount' }), h('div', { id: 'reqIn' }),
    h('h3', { class: 'sec', id: 'outCount' }), h('div', { id: 'reqOut' })));
  renderRequestLists();
}

function renderRequestLists() {
  const rin = $('#reqIn'), rout = $('#reqOut'); if (!rin || !rout) return;
  const inc = incoming(), out = outgoing();
  loadProfiles([...inc, ...out].map(otherId));
  $('#inCount').textContent = `Binnenkomend — ${inc.length}`;
  $('#outCount').textContent = `Verstuurd — ${out.length}`;
  const empty = (t) => h('p', { class: 'hint', text: t });

  rin.replaceChildren(...(inc.length ? inc.map(f => h('div', { class: 'row' },
    avatar(otherId(f), otherName(f), 42, true),
    h('span', { class: 'item-text' }, h('b', { text: otherName(f) }), h('small', { text: 'wil vrienden worden' })),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn-ok', type: 'button', text: 'Accepteren',
        onclick: async () => { try { await updateDoc(doc(db, 'friendships', f.id), { status: 'accepted' }); toast(`Jij en ${otherName(f)} zijn nu vrienden!`); } catch (e) { toast(fbErr(e)); } }
      }),
      h('button', {
        class: 'btn-no', type: 'button', text: 'Weigeren',
        onclick: async () => { try { await deleteDoc(doc(db, 'friendships', f.id)); } catch (e) { toast(fbErr(e)); } }
      })))) : [empty('Geen binnenkomende verzoeken.')]));

  rout.replaceChildren(...(out.length ? out.map(f => h('div', { class: 'row' },
    avatar(otherId(f), otherName(f), 42, true),
    h('span', { class: 'item-text' }, h('b', { text: otherName(f) }), h('small', { text: 'wacht op antwoord' })),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn-no', type: 'button', text: 'Annuleren',
        onclick: async () => { try { await deleteDoc(doc(db, 'friendships', f.id)); } catch (e) { toast(fbErr(e)); } }
      })))) : [empty('Geen openstaande verzoeken.')]));
}

/* =====================  servers  ===================== */
const dlg = $('#dlg');
const openDialog = (...nodes) => { dlg.classList.remove('wide'); dlg.replaceChildren(h('div', { class: 'dlg-in' }, ...nodes)); if (!dlg.open) dlg.showModal(); };
const closeDialog = () => { if (dlg.open) dlg.close(); };
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

function openCreateServer() {
  const inp = h('input', { class: 'inp', maxlength: 30, placeholder: 'Naam van de server' });
  const err = h('p', { class: 'err' });
  const go = async () => {
    const name = inp.value.trim();
    if (!name) { err.textContent = 'Geef de server een naam.'; return; }
    try {
      const ref = await addDoc(collection(db, 'servers'), { name, ownerId: S.me.uid, members: [S.me.uid], createdAt: serverTimestamp() });
      closeDialog(); S.activeServer = ref.id; renderSidebar(); showMain();
    } catch (e) { err.textContent = fbErr(e); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  openDialog(
    h('h3', { text: 'Server maken' }),
    h('p', { class: 'sub', text: 'Een eigen plek om met meerdere mensen te chatten.' }),
    inp, err,
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Annuleren' }),
      h('button', { class: 'glow', type: 'button', onclick: go, text: 'Maken' })));
  inp.focus();
}

function openJoinServer() {
  const inp = h('input', { class: 'inp', placeholder: 'Plak de uitnodigingscode', autocomplete: 'off' });
  const err = h('p', { class: 'err' });
  const go = async () => {
    const code = inp.value.trim();
    if (!code || code.includes('/')) { err.textContent = 'Dat is geen geldige code.'; return; }
    if (S.servers.some(s => s.id === code)) { err.textContent = 'Je zit al in deze server.'; return; }
    try {
      await updateDoc(doc(db, 'servers', code), { members: arrayUnion(S.me.uid) });
      closeDialog(); S.activeServer = code; renderSidebar(); showMain();
    } catch (e) {
      err.textContent = /permission|not-found/.test(e.code || '') ? 'Ongeldige code.' : fbErr(e);
    }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  openDialog(
    h('h3', { text: 'Joinen met code' }),
    h('p', { class: 'sub', text: 'Vraag de eigenaar van de server om de uitnodigingscode.' }),
    inp, err,
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Annuleren' }),
      h('button', { class: 'glow', type: 'button', onclick: go, text: 'Joinen' })));
  inp.focus();
}

async function leaveServer(s) {
  if (!confirm(`Server "${s.name}" verlaten?`)) return;
  try { await updateDoc(doc(db, 'servers', s.id), { members: arrayRemove(S.me.uid) }); }
  catch (e) { toast(fbErr(e)); }
}
async function deleteServer(s) {
  if (!confirm(`Server "${s.name}" voor iedereen verwijderen?`)) return;
  try { await deleteDoc(doc(db, 'servers', s.id)); }
  catch (e) { toast(fbErr(e)); }
}

/* =====================  online / inactief / offline  =====================
   - presence/{uid}          { state, lastSeen }   publiek leesbaar voor ingelogde gebruikers (per uid, niet opvraagbaar als lijst)
   - presenceSettings/{uid}  { mode, until }       alleen jijzelf (handmatige status, until = 0 betekent voor altijd)
   Schrijven gebeurt zuinig: alleen bij een echte statuswijziging (met minimale tussentijd) of als hartslag. */
const HEARTBEAT = 120000;   // elke 2 min een hartslag zolang je online/inactief bent
const MIN_GAP   = 20000;    // nooit vaker dan 1 write per 20 s (rules staan 15 s toe)
const STALE     = 270000;   // geen hartslag in 4,5 min -> bij anderen offline
const PEER_TTL  = 190000;   // andere tabbladen van jezelf (zelfde browser)
const LABEL = { online: 'Online', idle: 'Inactief', dnd: 'Niet storen', offline: 'Offline' };
const MODES = [
  ['auto', 'Online', 'Automatisch: online als je de site bekijkt, inactief op de achtergrond'],
  ['idle', 'Inactief', 'Je staat als inactief, ook als je de site bekijkt'],
  ['dnd', 'Niet storen', 'Anderen zien dat je even niet gestoord wilt worden'],
  ['invisible', 'Onzichtbaar', 'Je lijkt offline voor anderen']
];
const DURS = [[15, '15 minuten'], [60, '1 uur'], [480, '8 uur'], [1440, '24 uur'], [0, 'Voor altijd']];
const MODE_KEYS = new Set(MODES.map(m => m[0]));

const P = { data: {}, unsub: {} };   // presence van anderen
const NAME = {};                     // uid -> gebruikersnaam (voor de ledenlijst)
const pres = {
  on: false, id: '', settings: { mode: 'auto', until: 0 }, peers: new Map(),
  published: null, lastAt: 0, fails: 0, timer: 0, ping: 0, tick: 0, bc: null, unsubSet: null
};
let membersView = null, watchT = 0;

/* --- eigen handmatige status --- */
function activeManual() {
  const s = pres.settings;
  if (!s || !MODE_KEYS.has(s.mode) || s.mode === 'auto') return null;
  if (s.until && s.until <= Date.now()) return null;   // verlopen -> weer automatisch
  return s.mode;
}
const manualState = () => { const m = activeManual(); return m === 'invisible' ? 'offline' : m; };
const manualExpiry = () => (activeManual() && pres.settings.until) || 0;

/* --- weergave --- */
function presState(uid) {
  if (uid === S.me?.uid) return manualState() || 'online';
  const p = P.data[uid];
  if (!p || p.state === 'offline') return 'offline';
  const ls = p.lastSeen?.toMillis?.();
  if (ls && Date.now() - ls > STALE) return 'offline';
  return p.state;
}
function setDot(d) { d.className = 'dot s-' + presState(d.dataset.uid); }
const sIcon = (st) => h('i', { class: 'sdot s-' + st });   // simpel gekleurd rondje
function pbadge(uid) { const st = presState(uid); return h('span', { class: 'pbadge s-' + st, 'data-uid': uid, text: LABEL[st] }); }
const ownLabel = () => activeManual() === 'invisible' ? 'Onzichtbaar' : LABEL[presState(S.me.uid)];
function srvMetaText(s) {
  const n = s.members.length, on = s.members.filter(u => presState(u) !== 'offline').length;
  return `${n} ${n === 1 ? 'lid' : 'leden'} · ${on} online`;
}
function renderPresence() {
  if (!S.me) return;
  document.querySelectorAll('.dot[data-uid]').forEach(setDot);
  for (const sel of ['.pbadge', '.plabel']) {
    document.querySelectorAll(sel + '[data-uid]').forEach(el => {
      const st = presState(el.dataset.uid);
      el.className = sel.slice(1) + ' s-' + st; el.textContent = LABEL[st];
    });
  }
  const pill = $('#statusBtn');
  if (pill) {
    pill.replaceChildren(sIcon(presState(S.me.uid)), ownLabel());
    pill.title = statusSummary();
  }
  const c = S.chat;
  if (c?.type === 'dm') {
    const el = $('#peerStatus'), i = dmInfo(c.id);
    if (el && i) {
      const st = presState(i.uid);
      el.replaceChildren(sIcon(st), [LABEL[st], el.dataset.st].filter(Boolean).join(' · '));
    }
  } else if (c?.type === 'server') {
    const el = $('#srvMeta'), s = serverInfo(c.id);
    if (el && s) el.textContent = srvMetaText(s);
  }
  membersView?.render();
}

/* --- presence van anderen volgen: vrienden + de leden van de server die je nu open hebt --- */
function scheduleWatch() { clearTimeout(watchT); watchT = setTimeout(syncPresenceWatch, 0); }
function syncPresenceWatch() {
  if (!S.me) return;
  const want = new Set(accepted().map(otherId));
  if (S.chat?.type === 'server') serverInfo(S.chat.id)?.members.forEach(u => want.add(u));
  want.delete(S.me.uid);
  for (const u of Object.keys(P.unsub)) {
    if (!want.has(u)) { P.unsub[u](); delete P.unsub[u]; delete P.data[u]; }
  }
  for (const u of want) {
    if (P.unsub[u]) continue;
    const offP = onSnapshot(doc(db, 'presence', u),
      s => { P.data[u] = s.exists() ? s.data() : null; renderPresence(); }, () => {});
    const offU = onSnapshot(doc(db, 'users', u),
      s => { PROF[u] = s.exists() ? s.data() : null; onProfChange(u); }, () => {});
    P.unsub[u] = () => { offP(); offU(); };
  }
  renderPresence();
}

/* --- eigen status publiceren (alleen de "leider"-tab schrijft, zodat meerdere tabs elkaar niet tegenwerken) --- */
const isVisible = () => document.visibilityState === 'visible';
function announce() { pres.bc?.postMessage({ id: pres.id, vis: isVisible() }); }
function onPeer(e) {
  const m = e.data;
  if (!m?.id || m.id === pres.id) return;
  if (m.bye) pres.peers.delete(m.id);
  else {
    const isNew = !pres.peers.has(m.id);
    pres.peers.set(m.id, { vis: !!m.vis, t: Date.now() });
    if (isNew) announce();
  }
  reconcile();
}

async function writeState(state) {
  pres.published = state; pres.lastAt = Date.now();
  try {
    await setDoc(doc(db, 'presence', S.me.uid), { state, lastSeen: serverTimestamp() });
    pres.fails = 0;
  } catch (e) {
    console.error(e);
    pres.published = null; pres.fails++;
    if (pres.fails === 3) toast(fbErr(e));
    reconcile();   // opnieuw proberen na de minimale tussentijd
  }
}

function reconcile() {
  clearTimeout(pres.timer);
  if (!pres.on || !S.me) return;
  const now = Date.now(), vis = isVisible();
  const live = [...pres.peers].filter(([, p]) => now - p.t < PEER_TTL);
  const anyVis = vis || live.some(([, p]) => p.vis);
  const pool = anyVis
    ? [...(vis ? [pres.id] : []), ...live.filter(([, p]) => p.vis).map(([id]) => id)]
    : [pres.id, ...live.map(([id]) => id)];
  if (pool.sort()[0] !== pres.id) {                      // een andere tab regelt het schrijven
    pres.published = null;
    pres.timer = setTimeout(reconcile, 60000);
    return;
  }
  const state = manualState() || (anyVis ? 'online' : 'idle');
  const gap = pres.fails >= 3 ? HEARTBEAT : MIN_GAP;
  let wait;
  if (state !== pres.published) wait = pres.lastAt + gap - now;              // echte wijziging
  else if (state === 'offline') wait = Infinity;                              // onzichtbaar: geen hartslag nodig
  else wait = pres.lastAt + HEARTBEAT - now;                                  // hartslag
  if (wait <= 0) { writeState(state); wait = state === 'offline' ? Infinity : HEARTBEAT; }
  const exp = manualExpiry();
  if (exp) wait = Math.min(wait, exp - now + 100);                            // handmatige status verloopt
  if (wait < Infinity) pres.timer = setTimeout(reconcile, Math.max(wait, 500));
}

const onVis = () => { announce(); reconcile(); renderPresence(); };
const onHide = () => pres.bc?.postMessage({ id: pres.id, bye: true });
const onShow = (e) => { if (e.persisted) { pres.published = null; announce(); reconcile(); } };

function startPresence() {
  if (pres.on || !S.me) return;
  Object.assign(pres, {
    on: true, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    settings: { mode: 'auto', until: 0 }, peers: new Map(), published: null, lastAt: 0, fails: 0
  });
  try { pres.bc = new BroadcastChannel('infinitum-presence-' + S.me.uid); pres.bc.onmessage = onPeer; }
  catch { pres.bc = null; }
  // pas schrijven nadat je instellingen binnen zijn (anders zou "onzichtbaar" even als online lekken)
  pres.unsubSet = onSnapshot(doc(db, 'presenceSettings', S.me.uid),
    s => { pres.settings = s.data() || { mode: 'auto', until: 0 }; renderPresence(); reconcile(); },
    () => reconcile());
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  announce();
  pres.ping = setInterval(announce, 60000);
  pres.tick = setInterval(renderPresence, 30000);        // verlopen hartslagen -> offline tonen
}

function stopPresence() {
  pres.on = false;
  clearTimeout(pres.timer); clearInterval(pres.ping); clearInterval(pres.tick);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('pagehide', onHide);
  window.removeEventListener('pageshow', onShow);
  onHide();
  try { pres.bc?.close(); } catch {}
  pres.bc = null; pres.peers = new Map();
  pres.unsubSet?.(); pres.unsubSet = null;
  clearTimeout(watchT);
  for (const u of Object.keys(P.unsub)) { P.unsub[u](); delete P.unsub[u]; }
  P.data = {};
  for (const k of Object.keys(NAME)) delete NAME[k];
  membersView = null;
}

async function presenceGoOffline() {
  if (!pres.on || !S.me) return;
  const uid = S.me.uid;
  stopPresence();
  try { await setDoc(doc(db, 'presence', uid), { state: 'offline', lastSeen: serverTimestamp() }); } catch {}
}

/* --- eigen status kiezen (klik op je avatar linksboven) --- */
function statusSummary() {
  const m = activeManual();
  if (!m) return 'Nu: automatisch (online als je de site bekijkt, inactief op de achtergrond).';
  const u = pres.settings.until, name = MODES.find(x => x[0] === m)[1];
  if (!u) return `Nu: ${name}, voor altijd.`;
  const d = new Date(u);
  return `Nu: ${name} tot ${dayKey(d) === dayKey(new Date()) ? '' : 'morgen '}${tf.format(d)}.`;
}

function openStatusPicker() {
  if (!S.me) return;
  let sel = activeManual() || 'auto';
  const list = h('div');
  const select = h('select', { class: 'inp' }, ...DURS.map(([m, t]) => h('option', { value: m, text: t })));
  select.value = '60';
  const durRow = h('label', { class: 'field' }, h('span', { text: 'Hoelang?' }), select);
  const err = h('p', { class: 'err' });
  const render = () => {
    list.replaceChildren(...MODES.map(([k, t, d]) => h('button', {
      class: 'item' + (sel === k ? ' active' : ''), type: 'button', onclick: () => { sel = k; render(); }
    },
      sIcon(k === 'auto' ? 'online' : k === 'invisible' ? 'offline' : k),
      h('span', { class: 'item-text' }, h('b', { text: t }), h('small', { text: d })))));
    durRow.hidden = sel === 'auto';
  };
  const go = async () => {
    const mins = +select.value;
    const until = sel === 'auto' || !mins ? 0 : Date.now() + mins * 60000;
    try { await setDoc(doc(db, 'presenceSettings', S.me.uid), { mode: sel, until }); closeDialog(); }
    catch (e) { err.textContent = fbErr(e); }
  };
  openDialog(
    h('h3', { text: 'Jouw status' }),
    h('p', { class: 'sub', text: statusSummary() }),
    list, durRow, err,
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Annuleren' }),
      h('button', { class: 'glow', type: 'button', onclick: go, text: 'Opslaan' })));
  render();
}

// status-knop onder je naam (linksboven)
const statusBtn = h('button', { class: 'status-pill', id: 'statusBtn', type: 'button', onclick: openStatusPicker });
$('#meName').after(statusBtn);

/* --- ledenlijst van de open server --- */
async function nameOf(uid) {
  if (PROF[uid]?.username) return PROF[uid].username;
  if (NAME[uid]) return NAME[uid];
  if (uid === S.me.uid) return S.profile?.username || 'Jij';
  const f = accepted().find(x => x.users.includes(uid));
  if (f?.names?.[uid]) return (NAME[uid] = f.names[uid]);
  try { const d = await getDoc(doc(db, 'users', uid)); return (NAME[uid] = d.data()?.username || 'Onbekend'); }
  catch { return 'Onbekend'; }
}

async function openMembers() {
  const c = S.chat; if (c?.type !== 'server') return;
  const s0 = serverInfo(c.id); if (!s0) return;
  const rank = { online: 0, dnd: 1, idle: 2, offline: 3 };
  const list = h('div', { class: 'mlist' });
  const render = () => {
    const s = serverInfo(c.id); if (!s) return;
    const rows = s.members.map(u => ({ u, n: NAME[u] || (u === S.me.uid ? S.profile?.username : '') || '…', st: presState(u) }))
      .sort((a, b) => rank[a.st] - rank[b.st] || a.n.localeCompare(b.n));
    list.replaceChildren(...rows.map(r => h('div', { class: 'row' },
      dotted(r.u, r.n, 40),
      h('span', { class: 'item-text' },
        h('b', { text: r.n + (r.u === S.me.uid ? ' (jij)' : '') }),
        h('small', { class: 'plabel s-' + r.st, text: LABEL[r.st] })))));
  };
  membersView = { render };
  openDialog(
    h('h3', { text: 'Leden' }),
    h('p', { class: 'sub', text: s0.name }),
    list,
    h('div', { class: 'dlg-actions' }, h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Sluiten' })));
  render();
  await Promise.all(s0.members.map(nameOf));
  if (membersView) render();
}
dlg.addEventListener('close', () => { membersView = null; });

/* =====================  instellingen, meldingen & profiel  =====================
   Instellingen (thema, achtergrond, meldingen) staan per apparaat in localStorage.
   Profielgegevens (foto, banner, bio, links) staan in users/{uid}. */
const SET_KEY = 'infinitum-settings';
const BGS = [
  { id: 'cosmos', name: 'Kosmos', file: 'hero-background.svg' },
  { id: 'aurora', name: 'Aurora', file: 'bg-aurora.svg' },
  { id: 'sunset', name: 'Zonsondergang', file: 'bg-sunset.svg' },
  { id: 'ocean', name: 'Oceaan', file: 'bg-ocean.svg' }
];
const CFG = (() => {
  const def = { theme: 'dark', bg: 'cosmos', profileClick: true, privacy: { readReceipts: true }, notif: { desktop: false, sound: true, dm: true, server: true, requests: true, preview: true } };
  try {
    const r = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
    return { ...def, ...r, notif: { ...def.notif, ...(r.notif || {}) }, privacy: { ...def.privacy, ...(r.privacy || {}) } };
  } catch { return def; }
})();
const saveSet = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(CFG)); } catch {} };

// klik op een profielfoto in de zijbalk opent het profiel (instelbaar bij Instellingen -> Profielen)
const rrOn = () => RR.enabled && CFG.privacy.readReceipts;
const applyProfileClick = () => { document.documentElement.dataset.pfclick = CFG.profileClick ? '1' : ''; };
applyProfileClick();

const lightMq = matchMedia('(prefers-color-scheme: light)');
function applyAppearance() {
  const r = document.documentElement;
  const theme = CFG.theme === 'system' ? (lightMq.matches ? 'light' : 'dark') : CFG.theme;
  r.dataset.theme = theme;
  r.dataset.bg = BGS.some(b => b.id === CFG.bg) ? CFG.bg : 'cosmos';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'light' ? '#eef0ff' : '#050816');
}
lightMq.addEventListener?.('change', () => { if (CFG.theme === 'system') applyAppearance(); });

$('#settingsBtn').innerHTML = I.gear;
$('#settingsBtn').addEventListener('click', () => setTab('settings'));

/* --- meldingen --- */
let audioCtx;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [[880, 0], [1175, .11]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(.12, t + d + .01);
      g.gain.exponentialRampToValueAtTime(.001, t + d + .22);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d); o.stop(t + d + .25);
    });
  } catch {}
}
const canDesktop = () => 'Notification' in window && Notification.permission === 'granted';

// kind: 'dm' | 'server' | 'requests'. Bij "Niet storen" komt er niets binnen.
function notify(kind, title, body, go) {
  if (!CFG.notif[kind] || manualState() === 'dnd') return;
  if (CFG.notif.sound) beep();
  const text = CFG.notif.preview ? body : 'Nieuw bericht';
  if (isVisible() && document.hasFocus()) { toast(`${title}: ${text}`); return; }
  if (CFG.notif.desktop && canDesktop()) {
    try {
      const n = new Notification(title, { body: text, icon: 'assets/favicon.svg', tag: 'infinitum-' + kind });
      n.onclick = () => { window.focus(); go?.(); n.close(); };
    } catch {}
  }
}
function checkNewRequests() {
  if (!S.me) return;
  const inc = incoming();
  if (S.reqSeen) {
    for (const f of inc) if (!S.reqSeen.has(f.id)) notify('requests', otherName(f), 'wil vrienden worden', () => setTab('requests'));
  }
  S.reqSeen = new Set(inc.map(f => f.id));
}
function testNotify() {
  if (CFG.notif.sound) beep();
  if (CFG.notif.desktop && canDesktop()) {
    try { new Notification('Infinitum', { body: 'Zo zien je meldingen eruit.', icon: 'assets/favicon.svg' }); } catch {}
  } else toast('Zo zien je meldingen eruit. 🔔');
}
const permText = () => !('Notification' in window) ? 'Je browser ondersteunt geen bureaubladmeldingen.'
  : Notification.permission === 'denied' ? 'Meldingen zijn geblokkeerd in je browser. Sta ze toe via het slotje naast de adresbalk.'
  : Notification.permission === 'granted' ? 'De browser geeft toestemming voor bureaubladmeldingen.'
  : 'De browser vraagt toestemming zodra je bureaubladmeldingen aanzet.';

/* --- instellingenpagina --- */
function renderSettings() {
  const THEMES = [['dark', 'Donker', '🌙'], ['light', 'Licht', '☀️'], ['system', 'Systeem', '🖥️']];
  const mark = () => {
    themeBtns.forEach((el, i) => el.classList.toggle('active', THEMES[i][0] === CFG.theme));
    bgBtns.forEach((el, i) => el.classList.toggle('active', BGS[i].id === CFG.bg));
  };
  const themeBtns = THEMES.map(([k, t, ic]) => h('button', {
    class: 'opt', type: 'button',
    onclick: () => { CFG.theme = k; saveSet(); applyAppearance(); mark(); }
  }, h('span', { text: ic }), t));
  const bgBtns = BGS.map(b => h('button', {
    class: 'bg-opt', type: 'button', title: b.name,
    onclick: () => { CFG.bg = b.id; saveSet(); applyAppearance(); mark(); }
  }, h('span', { class: 'bg-thumb', style: `background-image:url(assets/${b.file})` }), h('span', { class: 'bg-name', text: b.name })));

  const permNote = h('p', { class: 'perm-note', text: permText() });
  const tog = (key, title, desc, onChange) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!CFG.notif[key];
    cb.addEventListener('change', async () => {
      if (onChange && !(await onChange(cb.checked))) { cb.checked = !cb.checked; return; }
      CFG.notif[key] = cb.checked; saveSet();
    });
    return h('label', { class: 'tog' }, h('span', { class: 'tog-text' }, h('b', { text: title }), h('small', { text: desc })), cb, h('i'));
  };
  const askDesktop = async (on) => {
    if (!on) return true;
    if (!('Notification' in window)) { permNote.textContent = permText(); return false; }
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch {} }
    permNote.textContent = permText();
    return p === 'granted';
  };

  const profTog = (() => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!CFG.profileClick;
    cb.addEventListener('change', () => { CFG.profileClick = cb.checked; saveSet(); applyProfileClick(); });
    return h('label', { class: 'tog' },
      h('span', { class: 'tog-text' },
        h('b', { text: 'Profiel openen via de zijbalk' }),
        h('small', { text: 'Klik op de profielfoto van een vriend in de lijst links om meteen zijn of haar profiel te openen. Uit = de foto opent gewoon het gesprek.' })),
      cb, h('i'));
  })();

  const rrTog = (() => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!CFG.privacy.readReceipts;
    cb.addEventListener('change', () => { CFG.privacy.readReceipts = cb.checked; saveSet(); syncReadWatch(); });
    return h('label', { class: 'tog' },
      h('span', { class: 'tog-text' },
        h('b', { text: 'Leesbewijzen' }),
        h('small', { text: 'Laat anderen met een oogje zien dat je hun bericht hebt gelezen. Uit = jij ziet ook niet wie jouw berichten leest.' })),
      cb, h('i'));
  })();

  $('#main').replaceChildren(h('div', { class: 'pane settings' },
    h('h2', { text: 'Instellingen' }),
    h('p', { class: 'sub', text: 'Deze instellingen worden op dit apparaat bewaard.' }),
    h('section', { class: 'set-card' },
      h('h3', { text: 'Weergave' }),
      h('p', { class: 'set-lbl', text: 'Thema' }), h('div', { class: 'opts' }, themeBtns),
      h('p', { class: 'set-lbl', text: 'Achtergrond' }), h('div', { class: 'bg-grid' }, bgBtns)),
    h('section', { class: 'set-card' },
      h('h3', { text: 'Profielen' }),
      profTog),
    h('section', { class: 'set-card' },
      h('h3', { text: 'Privacy' }),
      rrTog),
    h('section', { class: 'set-card' },
      h('h3', { text: 'Meldingen' }),
      tog('desktop', 'Bureaubladmeldingen', 'Een melding van je browser als de site op de achtergrond staat.', askDesktop),
      tog('dm', 'Directe berichten', 'Een melding bij een nieuw bericht van een vriend.'),
      tog('server', 'Servers', 'Alleen voor de server die open staat terwijl de site op de achtergrond is.'),
      tog('requests', 'Vriendschapsverzoeken', 'Een melding als iemand je een verzoek stuurt.'),
      tog('sound', 'Geluid', 'Een kort geluidje bij elke melding.'),
      tog('preview', 'Berichttekst tonen', 'Uit = je ziet alleen dat er een bericht is, niet wat erin staat.'),
      permNote,
      h('button', { class: 'ghost sm', type: 'button', onclick: testNotify, text: 'Testmelding sturen' }),
      h('p', { class: 'perm-note', text: 'Staat je status op "Niet storen", dan krijg je geen meldingen.' })),
    h('p', { class: 'hint', text: 'Tip: klik op je profielfoto linksboven om je foto, banner, bio en links aan te passen.' })));
  mark();
}

/* --- links als knop (link-icoon + favicon + naam) --- */
const BRAND = {
  youtube: 'YouTube', youtu: 'YouTube', github: 'GitHub', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X', x: 'X',
  twitch: 'Twitch', discord: 'Discord', spotify: 'Spotify', linkedin: 'LinkedIn', reddit: 'Reddit', facebook: 'Facebook',
  steam: 'Steam', steampowered: 'Steam', soundcloud: 'SoundCloud', pinterest: 'Pinterest', snapchat: 'Snapchat',
  telegram: 'Telegram', whatsapp: 'WhatsApp', paypal: 'PayPal', patreon: 'Patreon', kick: 'Kick', roblox: 'Roblox',
  bsky: 'Bluesky', bluesky: 'Bluesky'
};
function parseLink(raw) {
  let s = String(raw || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const parts = host.split('.');
  let base = parts[parts.length - 2];
  if (parts.length > 2 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(base)) base = parts[parts.length - 3];
  const name = BRAND[base] || (base[0].toUpperCase() + base.slice(1));
  return { href: u.href, host, name };
}
function linkChip(l, onRemove) {
  const info = parseLink(l);   // altijd opnieuw controleren: alleen http(s)-links worden ooit een <a>
  if (!info) return null;
  const inner = [
    h('span', { class: 'lk', html: I.link }),
    h('img', {
      class: 'fav', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
      onerror: e => e.target.remove(),
      src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(info.host)}&sz=64`
    }),
    h('span', { text: info.name })
  ];
  if (!onRemove) return h('a', { class: 'linkbtn', href: info.href, target: '_blank', rel: 'noopener noreferrer nofollow', title: info.href }, ...inner);
  return h('span', { class: 'linkbtn' }, ...inner,
    h('button', { class: 'lk-x', type: 'button', html: I.x, 'aria-label': 'Link verwijderen', onclick: onRemove }));
}

/* --- reageren op profielwijzigingen van anderen (naam/foto) --- */
function onProfChange(u) {
  refreshAvatars(); scheduleSidebar();
  if (S.tab === 'friends') renderFriendList();
  if (S.chat?.type === 'dm' && dmInfo(S.chat.id)?.uid === u) {
    const old = $('#chatHead');
    if (old) { old.replaceWith(buildHead('dm', S.chat.id)); renderPresence(); }
  }
}

/* --- afbeeldingen: kiezen, slepen-en-neerzetten, bijsnijden (slepen + zoomen) --- */
const imgBg = (src, id) => {
  const b = safeBanner(src);
  if (HEX_RE.test(b)) return b;
  return b ? `center / cover no-repeat url("${b}")` : gradFor(id);
};
function paintBig(el, src, id, name) {
  const s = safeImg(src);
  el.style.background = s ? `center / cover no-repeat url("${s}")` : gradFor(id);
  el.textContent = s ? '' : letterOf(name);
}
function pickFile() {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => res(inp.files[0] || null);
    inp.addEventListener('cancel', () => res(null));
    inp.click();
  });
}
function dropTarget(el, onFile) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  el.addEventListener('dragover', e => { stop(e); el.classList.add('drop'); });
  el.addEventListener('dragleave', e => { stop(e); el.classList.remove('drop'); });
  el.addEventListener('drop', e => {
    stop(e); el.classList.remove('drop');
    const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) onFile(f); else toast('Sleep een afbeelding (jpg, png, webp of gif).');
  });
}

// Toont de afbeelding in een vak ter grootte van het resultaat: sleep om te verplaatsen, zoom met schuifbalk of muiswiel.
async function openCropper(file, outW, outH, { round = false, maxLen = 140000 } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { toast('Die afbeelding kon niet worden geladen.'); return null; }

  return new Promise(resolve => {
    const VW = Math.max(160, Math.min(round ? 280 : 460, window.innerWidth - 100));
    const VH = Math.round(VW * outH / outW);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = h('canvas', { class: 'crop-cv' + (round ? ' round' : '') });
    cv.width = VW * dpr; cv.height = VH * dpr; cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
    const ctx = cv.getContext('2d');

    const base = Math.max(VW / bmp.width, VH / bmp.height);   // minimale schaal: de afbeelding vult het vak
    let zoom = 1, ox = (VW - bmp.width * base) / 2, oy = (VH - bmp.height * base) / 2;
    const slider = h('input', { type: 'range', min: 1, max: 4, step: .01, value: 1, 'aria-label': 'Zoom' });
    const clamp = () => {
      ox = Math.min(0, Math.max(VW - bmp.width * base * zoom, ox));
      oy = Math.min(0, Math.max(VH - bmp.height * base * zoom, oy));
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b1030'; ctx.fillRect(0, 0, VW, VH);
      ctx.drawImage(bmp, ox, oy, bmp.width * base * zoom, bmp.height * base * zoom);
    };
    const setZoom = (z, cx = VW / 2, cy = VH / 2) => {
      z = Math.min(4, Math.max(1, z));
      const k = z / zoom;
      ox = cx - (cx - ox) * k; oy = cy - (cy - oy) * k; zoom = z;
      clamp(); slider.value = z; draw();
    };
    slider.addEventListener('input', () => setZoom(+slider.value));

    let drag = null;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox, oy }; });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y;
      clamp(); draw();
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // het resultaat is precies wat je in het vak ziet
    const render = () => {
      const o = document.createElement('canvas'); o.width = outW; o.height = outH;
      const c = o.getContext('2d'), k = outW / VW;
      c.fillStyle = '#0b1030'; c.fillRect(0, 0, outW, outH);
      c.drawImage(bmp, ox * k, oy * k, bmp.width * base * zoom * k, bmp.height * base * zoom * k);
      for (const q of [.88, .75, .6, .45, .3]) {
        const s = o.toDataURL('image/jpeg', q);
        if (s.length <= maxLen) return s;
      }
      return null;
    };

    const dl = document.createElement('dialog');
    dl.className = 'crop-dlg';
    const done = (v) => { if (dl.open) dl.close(); dl.remove(); bmp.close?.(); resolve(v); };
    dl.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dl.append(h('div', { class: 'dlg-in' },
      h('h3', { text: round ? 'Profielfoto bijsnijden' : 'Banner bijsnijden' }),
      h('p', { class: 'sub', text: 'Sleep de afbeelding om hem te verplaatsen en zoom met de schuifbalk of het muiswiel.' }),
      h('div', { class: 'crop-stage' }, cv),
      h('label', { class: 'crop-zl' }, h('span', { text: 'Zoom' }), slider),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'ghost', type: 'button', text: 'Annuleren', onclick: () => done(null) }),
        h('button', { class: 'glow', type: 'button', text: 'Gebruiken', onclick: () => {
          const s = render();
          if (!s) { toast('Die afbeelding is te groot. Probeer een kleinere.'); return; }
          done(s);
        } }))));
    document.body.append(dl);
    dl.showModal();
    draw();
  });
}

/* --- eigen profiel bewerken (klik op je profielfoto) --- */
function openProfileEditor() {
  const p = S.profile || {}, uid = S.me.uid, name = p.username || '?';
  const d = {
    avatar: safeImg(p.avatar), banner: safeBanner(p.banner), bio: p.bio || '', status: p.status || '',
    links: (p.links || []).filter(l => parseLink(l))
  };
  const lockedUntil = (p.usernameChangedAt?.toMillis?.() || 0) + 7 * 864e5;
  const locked = lockedUntil > Date.now();
  const err = h('p', { class: 'err' });

  const setBanner = async (file) => { const s = await openCropper(file, 720, 240, { maxLen: 140000 }); if (s) { d.banner = s; paint(); } };
  const setAvatar = async (file) => { const s = await openCropper(file, 160, 160, { round: true, maxLen: 38000 }); if (s) { d.avatar = s; paint(); } };
  const choose = (fn) => async () => { const f = await pickFile(); if (f) fn(f); };

  const banner = h('button', { class: 'pf-banner', type: 'button', title: 'Klik of sleep een afbeelding', onclick: choose(setBanner) },
    h('span', { class: 'pf-cta', text: 'Klik of sleep een afbeelding' }));
  dropTarget(banner, setBanner);
  const av = h('span', { class: 'avatar big', style: '--s:88px' });
  const avBtn = h('button', { class: 'pf-av', type: 'button', title: 'Klik of sleep een afbeelding', onclick: choose(setAvatar) },
    av, h('span', { class: 'pf-cta', text: 'Wijzig' }));
  dropTarget(avBtn, setAvatar);

  const rmAv = h('button', { class: 'ghost sm', type: 'button', text: 'Foto verwijderen', onclick: () => { d.avatar = ''; paint(); } });
  const rmBanner = h('button', { class: 'ghost sm', type: 'button', text: 'Banner leegmaken', onclick: () => { d.banner = ''; paint(); } });

  // bannerkleur
  const color = h('input', { type: 'color', class: 'pf-color', title: 'Kies een kleur', 'aria-label': 'Bannerkleur' });
  color.value = HEX_RE.test(d.banner) ? d.banner : '#7c5cff';
  const useColor = (c) => { color.value = c; d.banner = c; paint(); };
  color.addEventListener('input', () => useColor(color.value));
  const swatches = ['#7c5cff', '#ff62d3', '#ffc857', '#38bdf8', '#43d17a', '#ff4d5e', '#1b1f3b'].map(c =>
    h('button', { class: 'sw', type: 'button', title: c, 'aria-label': 'Kleur ' + c, style: `background:${c}`, onclick: () => useColor(c) }));

  const paint = () => {
    banner.style.background = imgBg(d.banner, uid + 'b');
    paintBig(av, d.avatar, uid, name);
    rmAv.hidden = !d.avatar; rmBanner.hidden = !d.banner;
  };

  const nameInp = h('input', { class: 'inp', maxlength: 20, autocomplete: 'off', spellcheck: 'false' });
  nameInp.value = name; nameInp.disabled = locked;
  const nameNote = h('small', {
    class: 'count left',
    text: locked ? `Je kunt je naam weer wijzigen vanaf ${df.format(new Date(lockedUntil))}.` : 'Je kunt je gebruikersnaam één keer per week wijzigen.'
  });
  const statusInp = h('input', { class: 'inp', maxlength: 40, autocomplete: 'off', placeholder: 'Wat ben je aan het doen?' });
  statusInp.value = d.status;

  const ta = h('textarea', { class: 'inp', rows: 3, maxlength: 200, placeholder: 'Vertel iets over jezelf…' });
  ta.value = d.bio;
  const cnt = h('small', { class: 'count' });
  const upd = () => { cnt.textContent = `${ta.value.length}/200`; };
  ta.addEventListener('input', upd); upd();

  const chips = h('div', { class: 'chips' });
  const renderLinks = () => chips.replaceChildren(...d.links.map((l, i) => linkChip(l, () => { d.links.splice(i, 1); renderLinks(); })));
  const linkInp = h('input', { class: 'inp', maxlength: 200, autocomplete: 'off', placeholder: 'https://youtube.com/@jouwkanaal' });
  const note = h('p', { class: 'note' });
  const addLink = () => {
    note.className = 'note'; note.textContent = '';
    const bad = (t) => { note.textContent = t; note.className = 'note bad'; };
    const info = parseLink(linkInp.value);
    if (!info || info.href.length > 200) return bad('Dat is geen geldige link.');
    if (d.links.length >= 6) return bad('Je kunt maximaal 6 links toevoegen.');
    if (d.links.includes(info.href)) return bad('Deze link staat er al.');
    d.links.push(info.href); linkInp.value = ''; renderLinks();
  };
  linkInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });

  const save = h('button', { class: 'glow', type: 'button', text: 'Opslaan' });
  save.onclick = async () => {
    err.textContent = '';
    const newName = nameInp.value.trim();
    const rename = !locked && newName !== name;
    if (rename) {
      if (!/^[A-Za-z0-9_.]{2,20}$/.test(newName)) { err.textContent = 'Gebruikersnaam: 2–20 tekens, alleen letters, cijfers, _ en .'; return; }
      if (!confirm(`Je wordt "${newName}". Daarna kun je je naam een week lang niet meer wijzigen. Doorgaan?`)) return;
    }
    save.disabled = true;
    try {
      const batch = writeBatch(db);
      const upd = { status: statusInp.value.trim().slice(0, 40), bio: ta.value.trim().slice(0, 200), avatar: d.avatar, banner: d.banner, links: d.links };
      if (rename) {
        const oldL = p.usernameLower || name.toLowerCase(), lower = newName.toLowerCase();
        if (lower !== oldL) {
          if ((await getDoc(doc(db, 'usernames', lower))).exists()) { err.textContent = 'Deze gebruikersnaam is al bezet.'; return; }
          batch.delete(doc(db, 'usernames', oldL));
          batch.set(doc(db, 'usernames', lower), { uid });
        }
        Object.assign(upd, { username: newName, usernameLower: lower, usernameChangedAt: serverTimestamp() });
      }
      batch.update(doc(db, 'users', uid), upd);
      await batch.commit();
      closeDialog(); toast(rename ? `Je heet nu ${newName}.` : 'Profiel opgeslagen.');
    } catch (e) { err.textContent = fbErr(e); }
    finally { save.disabled = false; }
  };

  openDialog(
    h('h3', { text: 'Jouw profiel' }),
    banner,
    h('div', { class: 'pf-row' }, avBtn, h('div', { class: 'pf-rm' }, rmAv)),
    h('div', { class: 'pf-bar' },
      h('button', { class: 'ghost sm', type: 'button', text: 'Bannerafbeelding kiezen', onclick: choose(setBanner) }),
      h('label', { class: 'pf-colorl' }, 'of kleur', color),
      swatches, rmBanner),
    h('label', { class: 'lbl', text: 'Gebruikersnaam' }), nameInp, nameNote,
    h('label', { class: 'lbl', text: 'Status' }), statusInp,
    h('label', { class: 'lbl', text: 'Bio' }), ta, cnt,
    h('div', { class: 'pf-links' },
      h('h4', { text: 'Links' }),
      h('p', { class: 'sub', text: 'Plak een link naar een andere site. Hij verschijnt in je profiel als knop met het logo van de site.' }),
      h('div', { class: 'addrow' }, linkInp, h('button', { class: 'ghost', type: 'button', onclick: addLink, text: 'Toevoegen' })),
      note, chips),
    err,
    h('div', { class: 'dlg-actions' }, h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Annuleren' }), save));
  dlg.classList.add('wide');
  paint(); renderLinks();
}

/* --- profiel van een ander bekijken --- */
async function openProfile(uid) {
  if (uid === S.me.uid) return openProfileEditor();
  let d = PROF[uid];
  try { const s = await getDoc(doc(db, 'users', uid)); if (s.exists()) d = s.data(); } catch {}
  if (!d) { toast('Profiel niet gevonden.'); return; }
  const f = accepted().find(x => otherId(x) === uid), st = presState(uid);
  const links = (d.links || []).map(l => linkChip(l)).filter(Boolean);
  const av = h('span', { class: 'avatar big', style: '--s:88px' });
  paintBig(av, d.avatar, uid, d.username);
  openDialog(
    h('div', { class: 'pf-banner view', style: 'background:' + imgBg(d.banner, uid + 'b') }),
    h('div', { class: 'pf-row' }, av),
    h('h3', { text: d.username }),
    h('p', { class: 'pf-state' }, sIcon(st), [LABEL[st], d.status].filter(Boolean).join(' · ')),
    d.bio ? h('p', { class: 'pf-bio', text: d.bio }) : null,
    links.length ? h('div', { class: 'pf-sec' }, h('h4', { text: 'Links' }), h('div', { class: 'chips' }, links)) : null,
    h('div', { class: 'dlg-actions' },
      f ? h('button', { class: 'btn-ok', type: 'button', text: 'Bericht', onclick: () => { closeDialog(); S.activeDm = f.id; S.tab = 'dms'; renderTabs(); renderSidebar(); showMain(); } }) : null,
      h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Sluiten' })));
  dlg.classList.add('wide');
}

// klik op een profielfoto (niet die in knoppen/dialogen) opent het profiel
document.addEventListener('click', e => {
  const a = e.target.closest('.avatar[data-uid]');
  if (!a || !S.me || a.closest('.item, dialog')) return;
  openProfile(a.dataset.uid);
});

// zijbalk (DM-lijst): foto aanklikken opent het profiel i.p.v. het gesprek, tenzij uitgezet in de instellingen
document.addEventListener('click', e => {
  if (!CFG.profileClick || !S.me) return;
  const a = e.target.closest('#sideList .item .avatar[data-uid]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  openProfile(a.dataset.uid);
}, true);

/* =====================  premium-knop  ===================== */
$('#premiumBtn').addEventListener('click', () => {
  openDialog(
    h('img', { class: 'dlg-logo', src: 'assets/infinitum-logo.svg', alt: 'Infinitum' }),
    h('p', { class: 'sub', text: 'Infinitum Premium komt eraan. Een voorproefje:' }),
    h('ul', { class: 'perks' },
      h('li', { text: '✦ Eigen profielkleuren en banner' }),
      h('li', { text: '✦ Grotere bestanden versturen' }),
      h('li', { text: '✦ Exclusieve emoji en badges' })),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'ghost', type: 'button', onclick: closeDialog, text: 'Sluiten' })));
});

applyAppearance();
setMode('login');
