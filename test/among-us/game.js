const firebaseConfig = {
    apiKey: "AIzaSyA0K4geAuueVfiItB_98-LkqRTnpYNUNvM",
    authDomain: "gameparadise-80490.firebaseapp.com",
    projectId: "gameparadise-80490",
    storageBucket: "gameparadise-80490.firebasestorage.app",
    messagingSenderId: "335620903527",
    appId: "1:335620903527:web:1bc1e01a386bf6e4e7fac2"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let state = { user: null, game: null, host: false, role: null, players: [], tasks: [], votes: {}, voting: false, killTarget: null };

const COLORS = ['#ff4d4d', '#3d8bff', '#2eb82e', '#e6c300', '#ff884d', '#ff88cc', '#9b59b6', '#ffffff', '#88ff88', '#888888'];

function code() { return 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('').sort(() => .5 - Math.random()).slice(0, 6).join(''); }
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); document.getElementById(id)?.classList.remove('hidden'); }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3000); }
function loggedIn() { return state.user !== null; }

// ==================== HOME ====================

document.getElementById('btn-play').addEventListener('click', () => {
    if (!loggedIn()) { toast('Je bent niet ingelogd!'); return; }
    show('lobby');
    subGames();
});

document.getElementById('btn-google').addEventListener('click', () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));

document.getElementById('btn-guest').addEventListener('click', () => {
    const name = document.getElementById('guest-name').value.trim();
    if (!name) { toast('Voer een naam in!'); return; }
    auth.signInAnonymously().then(() => {
        state.user = { uid: 'g' + Date.now(), name, guest: true };
    });
});

document.getElementById('btn-logout').addEventListener('click', () => auth.signOut());

// ==================== AUTH ====================

auth.onAuthStateChanged(user => {
    if (user) {
        state.user = { uid: user.uid, name: user.displayName || user.email?.split('@')[0] || 'Player', email: user.email, guest: user.isAnonymous };
        document.getElementById('player-name').textContent = state.user.name;
        show('lobby');
        subGames();
    } else {
        state.user = null;
        show('home');
    }
});

// ==================== LOBBY ====================

document.getElementById('btn-create').addEventListener('click', async () => {
    if (!loggedIn()) { toast('Je bent niet ingelogd!'); return; }
    const name = document.getElementById('game-name').value.trim() || 'Game';
    const map = document.getElementById('map-select').value;
    const imps = parseInt(document.getElementById('impostor-count').value);
    const id = code();
    await db.collection('amongus_map').doc(id).set({ name, map, impostors: imps, host: state.user.uid, hostName: state.user.name, status: 'waiting', created: Date.now() });
    joinGame(id, true);
    toast('Spel aangemaakt!');
});

document.getElementById('btn-join').addEventListener('click', () => {
    if (!loggedIn()) { toast('Je bent niet ingelogd!'); return; }
    const id = document.getElementById('join-code').value.trim().toUpperCase();
    if (id.length !== 6) { toast('Ongeldige code!'); return; }
    joinGame(id, false);
});

document.getElementById('btn-back').addEventListener('click', () => show('home'));

async function joinGame(id, asHost) {
    const doc = await db.collection('amongus_map').doc(id).get();
    if (!doc.exists) { toast('Spel niet gevonden!'); return; }
    const data = doc.data();
    if (data.status === 'playing') { toast('Spel al begonnen!'); return; }
    state.game = id;
    state.host = asHost || data.host === state.user.uid;
    await db.collection('amongus_map').doc(id).collection('players').doc(state.user.uid).set({ uid: state.user.uid, name: state.user.name, alive: true, host: state.host, x: 130, y: 115 });
    show('game');
    document.getElementById('game-code').textContent = id;
    document.getElementById('btn-start').classList.toggle('hidden', !state.host);
    document.getElementById('wait-host').classList.toggle('hidden', state.host);
    subGame(id);
}

let unsubGames, unsubGame, unsubPlayers, unsubChat, unsubVotes;

function subGames() {
    if (unsubGames) unsubGames();
    unsubGames = db.collection('amongus_map').where('status', '==', 'waiting').onSnapshot(snap => {
        const list = document.getElementById('games-list');
        list.innerHTML = '';
        snap.forEach(d => { const g = d.data(); const div = document.createElement('div'); div.className = 'game-item'; div.innerHTML = `<div class="game-name">${g.name}</div><div class="game-info">${g.impostors} Impostor</div>`; div.onclick = () => document.getElementById('join-code').value = d.id; list.appendChild(div); });
    });
}

function subGame(id) {
    if (unsubGame) unsubGame(); if (unsubPlayers) unsubPlayers(); if (unsubChat) unsubChat(); if (unsubVotes) unsubVotes();
    
    unsubGame = db.collection('amongus_map').doc(id).onSnapshot(d => {
        if (!d.exists) { toast('Spel verwijderd!'); return lobby(); }
        const g = d.data();
        document.getElementById('players-count').textContent = `${state.players.length}/10`;
        if (g.status === 'playing' && !state.role) startGame(g);
        if (g.voting && !state.voting) startVote();
        else if (!g.voting && state.voting) endVote();
        if (state.user.email === 'someoeneheilig@gmail.com' || state.user.email === 'melle1337k@gmail.com') document.getElementById('admin').classList.remove('hidden');
    });
    
    unsubPlayers = db.collection('amongus_map').doc(id).collection('players').onSnapshot(snap => { state.players = snap.docs.map(d => ({ id: d.id, ...d.data() })); updatePlayers(); drawMap(); });
    
    unsubChat = db.collection('amongus_map').doc(id).collection('chat').orderBy('time').onSnapshot(snap => { const box = document.getElementById('chat-messages'); box.innerHTML = ''; snap.forEach(d => { const m = d.data(); const div = document.createElement('div'); div.className = 'chat-msg' + (m.sys ? ' system' : ''); div.innerHTML = m.sys ? m.text : `<span class="name">${m.name}:</span> ${m.text}`; box.appendChild(div); }); box.scrollTop = box.scrollHeight; });
    
    unsubVotes = db.collection('amongus_map').doc(id).collection('votes').onSnapshot(snap => { state.votes = {}; snap.forEach(d => state.votes[d.id] = d.data()); });
}

function updatePlayers() {
    const list = document.getElementById('players-list'); list.innerHTML = '';
    state.players.forEach((p, i) => { const div = document.createElement('div'); div.className = 'player-item'; div.innerHTML = `<div class="player-color" style="background:${COLORS[i % 10]}"></div><span class="player-name">${p.name}${p.host ? ' ★' : ''}</span><span class="player-status">${p.alive ? '🟢' : '🔴'}</span>`; if (state.role === 'impostor' && p.alive && !p.impostor) { div.style.cursor = 'pointer'; div.onclick = () => selectTarget(p); } list.appendChild(div); });
}

function drawMap() {
    const svg = document.getElementById('game-map'); svg.innerHTML = '';
    const rooms = [
        { id: 'cafeteria', x: 80, y: 80, w: 100, h: 70, name: 'Cafeteria' },
        { id: 'weapons', x: 210, y: 40, w: 70, h: 50, name: 'Weapons' },
        { id: 'o2', x: 310, y: 40, w: 70, h: 50, name: 'O2' },
        { id: 'nav', x: 410, y: 40, w: 90, h: 60, name: 'Navigation' },
        { id: 'shields', x: 80, y: 180, w: 70, h: 50, name: 'Shields' },
        { id: 'medbay', x: 180, y: 170, w: 70, h: 60, name: 'MedBay' },
        { id: 'security', x: 280, y: 150, w: 70, h: 50, name: 'Security' },
        { id: 'admin', x: 380, y: 130, w: 70, h: 50, name: 'Admin' },
        { id: 'electrical', x: 80, y: 280, w: 70, h: 50, name: 'Electrical' },
        { id: 'lowereng', x: 180, y: 270, w: 70, h: 50, name: 'Lower Eng' },
        { id: 'uppereng', x: 280, y: 270, w: 70, h: 50, name: 'Upper Eng' },
        { id: 'reactor', x: 400, y: 250, w: 70, h: 70, name: 'Reactor' },
        { id: 'storage', x: 500, y: 120, w: 70, h: 90, name: 'Storage' }
    ];
    rooms.forEach(r => { const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.setAttribute('x', r.x); rect.setAttribute('y', r.y); rect.setAttribute('width', r.w); rect.setAttribute('height', r.h); rect.setAttribute('fill', '#1e1e30'); rect.setAttribute('stroke', '#3a3a50'); rect.setAttribute('rx', '5'); svg.appendChild(rect); const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text'); txt.setAttribute('x', r.x + r.w/2); txt.setAttribute('y', r.y + r.h/2 + 4); txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', '#666'); txt.setAttribute('font-size', '9'); txt.textContent = r.name; svg.appendChild(txt); });
    state.players.forEach((p, i) => { if (!p.alive && state.role !== 'impostor') return; const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', p.x || 130); c.setAttribute('cy', p.y || 115); c.setAttribute('r', '12'); c.setAttribute('fill', COLORS[i % 10]); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2'); svg.appendChild(c); });
}

// ==================== GAME ====================

document.getElementById('btn-start').addEventListener('click', async () => {
    const ref = db.collection('amongus_map').doc(state.game);
    const imps = (await ref.get()).data().impostors;
    const shuffled = [...state.players].sort(() => .5 - Math.random());
    for (let i = 0; i < shuffled.length; i++) { const isImp = i < imps; await ref.collection('players').doc(shuffled[i].id).update({ impostor: isImp }); if (shuffled[i].id === state.user.uid) state.role = isImp ? 'impostor' : 'crewmate'; }
    await ref.update({ status: 'playing' });
});

function startGame(g) {
    const me = state.players.find(p => p.id === state.user.uid);
    state.role = me?.impostor ? 'impostor' : 'crewmate';
    show('role-screen');
    const disp = document.getElementById('role-display');
    const name = document.getElementById('role-name');
    const desc = document.getElementById('role-desc');
    if (state.role === 'impostor') {
        disp.className = 'role-crewmate impostor';
        name.textContent = 'IMPOSTOR';
        name.style.color = '#e62e2e';
        desc.textContent = 'Kill alle Crewmates!';
        document.getElementById('btn-kill').classList.remove('hidden');
        document.getElementById('btn-sabotage').classList.remove('hidden');
    } else {
        disp.className = 'role-crewmate';
        name.textContent = 'CREWMATE';
        name.style.color = '#3d8bff';
        desc.textContent = 'Doe je taken en vind de Impostor!';
        document.getElementById('tasks-box').classList.remove('hidden');
        if (me?.tasks) { state.tasks = me.tasks; updateTasks(); }
    }
}

function updateTasks() {
    const list = document.getElementById('tasks-list'); list.innerHTML = '';
    const done = state.tasks.filter(t => t.done).length;
    document.getElementById('task-progress').textContent = Math.round(done / state.tasks.length * 100) + '%';
    state.tasks.forEach((t, i) => { const div = document.createElement('div'); div.className = 'task-item' + (t.done ? ' completed' : ''); div.innerHTML = `<div class="task-check"></div><span>${t.name}</span>`; if (!t.done) div.onclick = () => doTask(i); list.appendChild(div); });
}

async function doTask(i) { state.tasks[i].done = true; updateTasks(); await db.collection('amongus_map').doc(state.game).collection('players').doc(state.user.uid).update({ tasks: state.tasks }); }

document.getElementById('btn-emergency').addEventListener('click', async () => { await db.collection('amongus_map').doc(state.game).update({ voting: true }); chat('🔔 Noodsmeeting!'); });

function selectTarget(p) { if (!p.alive || state.role !== 'impostor') return; state.killTarget = p; toast(`Klik nogmaals om ${p.name} te doden`); }

document.getElementById('btn-kill').addEventListener('click', async () => { if (!state.killTarget) { toast('Selecteer een speler!'); return; } await db.collection('amongus_map').doc(state.game).collection('players').doc(state.killTarget.id).update({ alive: false }); chat(`💀 ${state.killTarget.name} is vermoord!`); checkWin(); state.killTarget = null; });

async function checkWin() { const aliveC = state.players.filter(p => p.alive && !p.impostor).length; const aliveI = state.players.filter(p => p.alive && p.impostor).length; if (aliveI === 0) endGame('crewmates'); else if (aliveI >= aliveC) endGame('impostors'); }

async function endGame(winner) {
    await db.collection('amongus_map').doc(state.game).update({ status: 'ended', winner });
    show('result');
    const title = document.getElementById('result-title'); const msg = document.getElementById('result-msg');
    if (winner === 'crewmates') { title.textContent = 'CREWMATES WINS!'; title.className = 'crewmates'; msg.textContent = 'Impostors gevonden!'; }
    else { title.textContent = 'IMPOSTORS WINS!'; title.className = 'impostors'; msg.textContent = 'Impostors hebben gewonnen!'; }
}

// ==================== VOTING ====================

function startVote() {
    state.voting = true; state.myVote = null;
    show('vote');
    const opts = document.getElementById('vote-options'); opts.innerHTML = '';
    state.players.filter(p => p.alive).forEach(p => { const div = document.createElement('div'); div.className = 'vote-option'; div.innerHTML = `<div class="color-box" style="background:${COLORS[state.players.indexOf(p) % 10]}"></div><div>${p.name}</div>`; div.onclick = () => castVote(p); opts.appendChild(div); });
    let t = 30; const timer = setInterval(() => { document.getElementById('vote-timer').textContent = t-- + 's'; if (t < 0) clearInterval(timer); }, 1000);
    setTimeout(finishVote, 30000);
}

async function castVote(p) { if (state.myVote) return; state.myVote = p.id; await db.collection('amongus_map').doc(state.game).collection('votes').doc(state.user.uid).set({ target: p.id, targetName: p.name, voter: state.user.uid }); toast('Gestemt op ' + p.name); }

async function finishVote() {
    const counts = {}; state.players.forEach(p => counts[p.id] = 0); Object.values(state.votes).forEach(v => counts[v.target] = (counts[v.target] || 0) + 1);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]); const max = sorted[0]?.[1] || 0; const total = Object.keys(state.votes).length;
    if (max > total / 2) { const ejected = state.players.find(p => p.id === sorted[0][0]); if (ejected) { await db.collection('amongus_map').doc(state.game).collection('players').doc(ejected.id).update({ alive: false }); chat(`🗳️ ${ejected.name} weggestemd!`); if (ejected.impostor) { await endGame('crewmates'); return; } else checkWin(); } }
    await db.collection('amongus_map').doc(state.game).update({ voting: false });
}

function endVote() { state.voting = false; state.myVote = null; show('game'); }
document.getElementById('btn-skip').addEventListener('click', async () => { if (state.myVote) return; await db.collection('amongus_map').doc(state.game).collection('votes').doc(state.user.uid).set({ target: 'skip', targetName: 'Skip', voter: state.user.uid }); });

// ==================== CHAT ====================

document.getElementById('btn-send').addEventListener('click', sendChat);
document.getElementById('chat-msg').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

async function sendChat() { const input = document.getElementById('chat-msg'); const text = input.value.trim(); if (!text) return; await db.collection('amongus_map').doc(state.game).collection('chat').add({ name: state.user.name, text, time: Date.now() }); input.value = ''; }
async function chat(text) { await db.collection('amongus_map').doc(state.game).collection('chat').add({ name: 'SYSTEM', text, sys: true, time: Date.now() }); }

// ==================== NAV ====================

document.getElementById('btn-leave').addEventListener('click', lobby);
document.getElementById('btn-lobby').addEventListener('click', lobby);

async function lobby() {
    if (state.game) { try { await db.collection('amongus_map').doc(state.game).collection('players').doc(state.user.uid).delete(); } catch(e) {} }
    cleanup();
    state.game = null; state.host = false; state.role = null; state.players = [];
    show('lobby'); subGames();
}

function cleanup() { if (unsubGame) unsubGame(); if (unsubPlayers) unsubPlayers(); if (unsubChat) unsubChat(); if (unsubVotes) unsubVotes(); }

document.getElementById('btn-kick').addEventListener('click', async () => { const ps = await db.collection('amongus_map').doc(state.game).collection('players').get(); ps.forEach(d => { if (d.id !== state.user.uid) d.ref.delete(); }); });
document.getElementById('btn-end').addEventListener('click', async () => { await db.collection('amongus_map').doc(state.game).update({ status: 'ended' }); lobby(); });
document.getElementById('btn-sabotage').addEventListener('click', () => toast('Sabotage binnenkort!'));

show('home');
