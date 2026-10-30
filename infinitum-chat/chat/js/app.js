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
  send: '<svg viewBox="0 0 24 24"><path d="M3.2 11.4 20.4 3.3c.9-.4 1.7.5 1.3 1.3L13.6 21.8c-.4.9-1.7.8-1.9-.2l-1.6-6.5L3.5 13.3c-1-.2-1.2-1.5-.3-1.9z" fill="url(#gradSend)"/></svg>',
  logout: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')
};

function hash(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
function avatar(id, name, size = 40) {
  const hu = hash(id) % 360;
  return h('span', {
    class: 'avatar',
    style: `--s:${size}px;background:linear-gradient(135deg,hsl(${hu} 80% 62%),hsl(${(hu + 70) % 360} 80% 52%))`,
    text: (String(name || '?').trim()[0] || '?').toUpperCase()
  });
}

// avatar met presence-bolletje; de kleur wordt live bijgewerkt door renderPresence()
function dotted(uid, name, size = 40) {
  const d = h('i', { class: 'dot', 'data-uid': uid });
  setDot(d);
  return h('span', { class: 'av-wrap', style: `--s:${size}px` }, avatar(uid, name, size), d);
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
  chat: null, unsub: {}, pendingName: null, started: false
};

const pairId = (a, b) => [a, b].sort().join('_');
const accepted = () => S.friendships.filter(f => f.status === 'accepted');
const incoming = () => S.friendships.filter(f => f.status === 'pending' && f.requester !== S.me.uid);
const outgoing = () => S.friendships.filter(f => f.status === 'pending' && f.requester === S.me.uid);
const otherId = (f) => f.users.find(u => u !== S.me.uid);
const otherName = (f) => (f.names && f.names[otherId(f)]) || 'Onbekend';
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
  S.unsub.profile = onSnapshot(doc(db, 'users', uid), s => { S.profile = s.data() || null; renderUserCard(); },
    e => console.error(e));

  S.unsub.friends = onSnapshot(query(collection(db, 'friendships'), where('users', 'array-contains', uid)), snap => {
    S.friendships = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    syncChatMeta(); scheduleWatch();
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

  startPresence();
}

function syncChatMeta() {
  const ids = new Set(accepted().map(f => f.id));
  for (const id of Object.keys(S.metaUnsub)) {
    if (!ids.has(id)) { S.metaUnsub[id](); delete S.metaUnsub[id]; delete S.meta[id]; }
  }
  for (const id of ids) {
    if (S.metaUnsub[id]) continue;
    S.metaUnsub[id] = onSnapshot(doc(db, 'chats', id), s => { S.meta[id] = s.data() || null; scheduleSidebar(); }, () => {});
  }
}

function unsubChat() { S.unsub.chat?.(); S.unsub.chat = null; S.chat = null; scheduleWatch(); }
function teardown() {
  stopPresence();
  unsubChat();
  for (const k of ['profile', 'friends', 'servers']) { S.unsub[k]?.(); S.unsub[k] = null; }
  Object.values(S.metaUnsub).forEach(u => u());
  Object.assign(S, { me: null, profile: null, friendships: [], meta: {}, metaUnsub: {}, servers: [], activeDm: null, activeServer: null, started: false, tab: 'dms' });
  $('#main').replaceChildren(); $('#sideList').replaceChildren(); $('#sideFoot').replaceChildren();
}

/* =====================  tabs + zijbalk  ===================== */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });

function setTab(t) { S.tab = t; renderTabs(); renderSidebar(); showMain(); }

function renderTabs() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const n = S.me ? incoming().length : 0;
  const bd = $('#reqBadge'); bd.hidden = !n; bd.textContent = n;
}

function renderUserCard() {
  const p = S.profile;
  $('#meAvatar').replaceChildren(dotted(S.me.uid, p?.username, 46));
  $('#meName').textContent = p?.username || '…';
  const si = $('#meStatus');
  if (document.activeElement !== si) si.value = p?.status || '';
}
$('#meStatus').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#meStatus').addEventListener('change', async e => {
  try { await updateDoc(doc(db, 'users', S.me.uid), { status: e.target.value.trim().slice(0, 40) }); }
  catch (ex) { toast(fbErr(ex)); }
});

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
      h('span', { class: 'item-text' }, h('b', { text: otherName(f) }), h('small', { text: preview }))));
  }
}

/* =====================  hoofdvlak  ===================== */
function showMain() {
  unsubChat();
  if (S.tab === 'friends') { renderFriends(); setView('main'); return; }
  if (S.tab === 'requests') { renderRequests(); setView('main'); return; }
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
  S.chat = { type, id, col, first: true };
  const name = type === 'dm' ? dmInfo(id).name : serverInfo(id).name;

  const ta = h('textarea', { id: 'msgInput', rows: 1, maxlength: 2000, placeholder: type === 'dm' ? `Bericht aan ${name}` : `Bericht in ${name}` });
  const doSend = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; ta.style.height = 'auto';
    try { await sendMessage(text); }
    catch (e) { ta.value = text; toast(fbErr(e)); }
  };
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });

  $('#main').replaceChildren(
    buildHead(type, id),
    h('div', { class: 'msgs', id: 'msgList' }),
    h('div', { class: 'composer' },
      h('div', { class: 'box' }, ta),
      h('button', { class: 'glow send', type: 'button', title: 'Versturen', 'aria-label': 'Versturen', html: I.send, onclick: doSend })));

  S.unsub.chat = onSnapshot(query(col, orderBy('createdAt', 'desc'), limit(100)), snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).reverse();
    renderMessages(msgs);
  }, e => { console.error(e); toast(fbErr(e)); });

  if (matchMedia('(min-width: 801px)').matches) ta.focus();
  scheduleWatch(); renderPresence();
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
  list.replaceChildren();
  if (!msgs.length) list.append(h('p', { class: 'start', text: 'Dit is het begin van jullie gesprek. Zeg hallo! 👋' }));

  let prev = null;
  for (const m of msgs) {
    const d = m.createdAt?.toDate?.() || new Date();
    const newDay = !prev || dayKey(prev.d) !== dayKey(d);
    if (newDay) list.append(h('div', { class: 'day', text: dayLabel(d) }));
    const grouped = !newDay && prev.uid === m.uid && d - prev.d < 5 * 60000;
    const mine = m.uid === S.me.uid;
    list.append(h('div', { class: `msg ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}` },
      mine && h('button', { class: 'icon-btn del', type: 'button', title: 'Verwijderen', 'aria-label': 'Bericht verwijderen', html: I.trash, onclick: () => deleteMessage(m.id) }),
      !mine && h('div', { class: 'msg-av' }, grouped ? null : avatar(m.uid, m.name, 34)),
      h('div', { class: 'msg-body' },
        !grouped && h('div', { class: 'meta' }, !mine && h('b', { text: m.name || 'Onbekend' }), h('time', { text: tf.format(d) })),
        h('div', { class: 'bubble', text: m.text }))));
    prev = { uid: m.uid, d };
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
  S.chat.first = false;
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
  $('#inCount').textContent = `Binnenkomend — ${inc.length}`;
  $('#outCount').textContent = `Verstuurd — ${out.length}`;
  const empty = (t) => h('p', { class: 'hint', text: t });

  rin.replaceChildren(...(inc.length ? inc.map(f => h('div', { class: 'row' },
    avatar(otherId(f), otherName(f), 42),
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
    avatar(otherId(f), otherName(f), 42),
    h('span', { class: 'item-text' }, h('b', { text: otherName(f) }), h('small', { text: 'wacht op antwoord' })),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn-no', type: 'button', text: 'Annuleren',
        onclick: async () => { try { await deleteDoc(doc(db, 'friendships', f.id)); } catch (e) { toast(fbErr(e)); } }
      })))) : [empty('Geen openstaande verzoeken.')]));
}

/* =====================  servers  ===================== */
const dlg = $('#dlg');
const openDialog = (...nodes) => { dlg.replaceChildren(h('div', { class: 'dlg-in' }, ...nodes)); if (!dlg.open) dlg.showModal(); };
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
function srvMetaText(s) {
  const n = s.members.length, on = s.members.filter(u => presState(u) !== 'offline').length;
  return `${n} ${n === 1 ? 'lid' : 'leden'} · ${on} online`;
}
function renderPresence() {
  if (!S.me) return;
  document.querySelectorAll('.dot[data-uid]').forEach(setDot);
  document.querySelectorAll('.plabel[data-uid]').forEach(el => { el.textContent = LABEL[presState(el.dataset.uid)]; });
  const c = S.chat;
  if (c?.type === 'dm') {
    const el = $('#peerStatus'), i = dmInfo(c.id);
    if (el && i) el.textContent = [LABEL[presState(i.uid)], el.dataset.st].filter(Boolean).join(' · ');
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
    P.unsub[u] = onSnapshot(doc(db, 'presence', u),
      s => { P.data[u] = s.exists() ? s.data() : null; renderPresence(); }, () => {});
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
      h('i', { class: 'dot inl s-' + (k === 'auto' ? 'online' : k === 'invisible' ? 'offline' : k) }),
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

const meAv = $('#meAvatar');
meAv.title = 'Status wijzigen'; meAv.setAttribute('role', 'button'); meAv.tabIndex = 0;
meAv.addEventListener('click', openStatusPicker);
meAv.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStatusPicker(); } });

/* --- ledenlijst van de open server --- */
async function nameOf(uid) {
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
        h('small', { text: LABEL[r.st] })))));
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

setMode('login');
