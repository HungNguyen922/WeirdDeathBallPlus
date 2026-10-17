// ACCOUNTS (server) - profiles, settings, ratings and the leaderboard, kept in Firestore on Firebase's free plan.
// Players never touch Firestore: their browser signs in with Firebase Auth, and every read and write goes through THIS file on the game server, which checks the sign-in token first.
// With FIREBASE_SERVICE_ACCOUNT unset (tests, local play) all of this switches off and the game plays exactly as before, as a guest.
//
// Data:  players/{uid}      { name, nameLower, settings, rating, matches, wins, losses, pointsFor, pointsAgainst, createdAt, updatedAt }
//        names/{nameLower}  { uid }   (claims a name so two players cannot share it)
'use strict';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const START_RATING = 1000, ELO_K = 32, MIN_RATING = 100;
const LB_TTL_MS = 5 * 60 * 1000, LB_FETCH = 60, LB_SHOW = 50; // the leaderboard is rebuilt at most every 5 minutes (about LB_FETCH reads each time)
const SETTING_KEYS = ['wdb-keybinds', 'wdb-music', 'wdb-chat', 'wdb-floorfx']; // browser settings an account may store (keep in step with SYNC_KEYS in js/net/account.js)

let db = null, auth = null, lb = { at: 0, rows: [] };
const userError = msg => Object.assign(new Error(msg), { user: true }); // an error whose message is safe to show the player
const enabled = () => !!db;
const players = () => db.collection('players'), names = () => db.collection('names');

function init() { // once; returns true if accounts are on
    if (db)
        return true;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw)
        return false;
    try {
        const { initializeApp, cert } = require('firebase-admin/app');
        const { getAuth } = require('firebase-admin/auth');
        const { getFirestore } = require('firebase-admin/firestore');
        initializeApp({ credential: cert(JSON.parse(raw)) });
        auth = getAuth();
        db = getFirestore();
        console.log('  accounts: on (Firebase)');
        return true;
    } catch (e) {
        console.error('  accounts: off -', e.message);
        db = auth = null;
        return false;
    }
}

async function verify(token) { // the player's uid, or null if the token is missing, forged or expired
    if (!db || typeof token !== 'string' || !token)
        return null;
    try { return (await auth.verifyIdToken(token)).uid; } catch (e) { return null; }
}

const pub = p => ({ name: p.name, rating: p.rating, matches: p.matches, wins: p.wins, losses: p.losses, pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst, settings: p.settings || {} });
async function getProfile(uid) { const s = await players().doc(uid).get(); return s.exists ? s.data() : null; }

async function identify(token) { // for the websocket join: { uid, name } (name is null until they have chosen one), or null for a guest
    const uid = await verify(token);
    if (!uid)
        return null;
    const p = await getProfile(uid).catch(() => null);
    return { uid, name: p ? p.name : null };
}

async function setName(uid, raw) { // first call creates the profile; later calls rename. Names are unique (case-insensitive).
    const name = String(raw || '').trim();
    if (!NAME_RE.test(name))
        throw userError('Names are 3 to 16 letters, numbers or underscores.');
    const key = name.toLowerCase(), pref = players().doc(uid), nref = names().doc(key);
    await db.runTransaction(async tx => {
        const [ps, ns] = await Promise.all([tx.get(pref), tx.get(nref)]); // (all reads first, then the writes)
        if (ns.exists && ns.data().uid !== uid)
            throw userError('That name is taken.');
        const old = ps.exists ? ps.data() : null, now = Date.now();
        if (old && old.nameLower && old.nameLower !== key)
            tx.delete(names().doc(old.nameLower)); // free the old name
        tx.set(nref, { uid });
        if (old)
            tx.update(pref, { name, nameLower: key, updatedAt: now });
        else
            tx.set(pref, { name, nameLower: key, settings: {}, rating: START_RATING, matches: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, createdAt: now, updatedAt: now });
    });
}

async function saveSettings(uid, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw userError('Bad settings.');
    const settings = {};
    for (const k of SETTING_KEYS)
        if (typeof raw[k] === 'string' && raw[k].length <= 4000)
            settings[k] = raw[k];
    const ref = players().doc(uid);
    if (!(await ref.get()).exists)
        throw userError('Pick a name first.');
    await ref.update({ settings, updatedAt: Date.now() });
}

async function leaderboard() {
    if (Date.now() - lb.at < LB_TTL_MS)
        return lb.rows;
    const snap = await players().orderBy('rating', 'desc').limit(LB_FETCH).get();
    lb = { at: Date.now(), rows: snap.docs.map(d => d.data()).filter(p => p.matches > 0).slice(0, LB_SHOW).map(p => ({ name: p.name, rating: p.rating, wins: p.wins, losses: p.losses })) };
    return lb.rows;
}

// A match just ended. teams = [[uid...] Blue, [uid...] Red] (null for a guest), score = [Blue points, Red points].
// Rated only when every seated player is signed in with a profile and nobody sits twice. Elo: each team's rating is the average of its players.
async function recordMatch({ teams, score }) {
    if (!db)
        return;
    const all = teams.flat();
    if (!teams[0].length || !teams[1].length || all.some(u => !u) || new Set(all).size !== all.length)
        return;
    const winner = score[0] > score[1] ? 0 : 1;
    try {
        await db.runTransaction(async tx => {
            const snaps = await Promise.all(all.map(u => tx.get(players().doc(u))));
            if (snaps.some(s => !s.exists))
                return;
            const data = snaps.map(s => s.data()), at = u => all.indexOf(u);
            const avg = t => teams[t].reduce((a, u) => a + data[at(u)].rating, 0) / teams[t].length;
            const expectBlue = 1 / (1 + Math.pow(10, (avg(1) - avg(0)) / 400));
            const delta = Math.round(ELO_K * ((winner === 0 ? 1 : 0) - expectBlue)); // what Blue gains; Red loses the same
            teams.forEach((team, t) => team.forEach(u => {
                const d = data[at(u)], won = t === winner;
                tx.update(players().doc(u), {
                    rating: Math.max(MIN_RATING, d.rating + (t === 0 ? delta : -delta)),
                    matches: d.matches + 1, wins: d.wins + (won ? 1 : 0), losses: d.losses + (won ? 0 : 1),
                    pointsFor: d.pointsFor + score[t], pointsAgainst: d.pointsAgainst + score[1 - t], updatedAt: Date.now()
                });
            }));
        });
    } catch (e) {
        console.error('could not record the match:', e.message);
    }
}

function readJson(req, max = 16384) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0, big = false;
        req.on('data', c => {
            if (big)
                return;
            size += c.length;
            if (size > max) {
                big = true;
                reject(userError('Request too large.'));
            } else
                chunks.push(c);
        });
        req.on('end', () => { if (!big) try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(userError('Bad request.')); } });
        req.on('error', reject);
    });
}

// The HTTP routes the browser uses:  GET /api/leaderboard (public)  GET /api/me  POST /api/name {name}  POST /api/settings {settings}   (the last three need "Authorization: Bearer <token>")
async function handleApi(req, res, pathname) {
    const send = (code, obj) => { if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj)); };
    if (!db)
        return send(503, { error: 'Accounts are not set up on this server.' });
    try {
        if (pathname === '/api/leaderboard' && req.method === 'GET')
            return send(200, { rows: await leaderboard() });
        const uid = await verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!uid)
            return send(401, { error: 'Please sign in again.' });
        if (pathname === '/api/me' && req.method === 'GET') {
            const p = await getProfile(uid);
            return send(200, { profile: p ? pub(p) : null });
        }
        if (req.method !== 'POST')
            return send(404, { error: 'not found' });
        const body = await readJson(req);
        if (pathname === '/api/name') {
            await setName(uid, body.name);
            return send(200, { profile: pub(await getProfile(uid)) });
        }
        if (pathname === '/api/settings') {
            await saveSettings(uid, body.settings);
            return send(200, { ok: true });
        }
        send(404, { error: 'not found' });
    } catch (e) {
        send(e.user ? 400 : 500, { error: e.user ? e.message : 'Something went wrong on the server.' });
        if (!e.user)
            console.error(e);
    }
}

module.exports = { init, enabled, identify, recordMatch, handleApi };