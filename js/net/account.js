// ACCOUNT - the browser side of sign-in. Firebase Auth is called straight from here with plain fetch (no Firebase library to load);
// the profile, settings and rankings go through the game server's /api routes with your sign-in token. Signed out = a guest: nothing is saved and the game works as before.
// Load before net/client.js.
const FIREBASE_API_KEY = 'AIzaSyC4c73_n9vbuvTeeGiBGZqXQCwSZ2C6cAc'; // PASTE: Firebase console > Project settings > General > Your apps > Web API key (public by design). Empty = accounts hidden.
const ACCOUNT_STORE = 'wdb-account'; // { refreshToken, uid, email }: what keeps you signed in on this device
const SYNC_KEYS = ['wdb-keybinds', 'wdb-music', 'wdb-chat', 'wdb-floorfx']; // settings that follow your account (keep in step with SETTING_KEYS in js/server/accounts.js)
const FB_ERRORS = {
    EMAIL_EXISTS: 'That email already has an account. Try signing in.',
    INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.', INVALID_PASSWORD: 'Wrong email or password.', EMAIL_NOT_FOUND: 'Wrong email or password.',
    INVALID_EMAIL: 'That email does not look right.', WEAK_PASSWORD: 'Use a password with at least 6 characters.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a bit and try again.', USER_DISABLED: 'This account has been disabled.'
};
const GAME_HOST = 'weirddeathballplus.onrender.com'; // your Render service hostname
const IS_LOCAL = !location.host || /^(localhost|127\.|192\.168\.)/.test(location.hostname);

// Stored as [{ layers }, ...] because Firestore does not allow arrays inside arrays.
const skinsToStore = skins => skins.map(layers => ({ layers }));
function skinSlots(p) { // older profiles only have `skin`: it becomes slot 0
    const skins = Array.isArray(p.skins) ? skinsClean(p.skins.map(s => s && s.layers)) : skinsClean([p.skin]);
    return { skins, slot: skinSlotOk(p.slot) ? p.slot : 0 };
}

function accountBase() {
    const q = new URLSearchParams(location.search).get('server');
    if (q)
        return q.includes('://') ? q.replace(/^ws/, 'http') : (location.protocol === 'https:' ? 'https://' : 'http://') + q;
    return IS_LOCAL ? '' : 'https://' + GAME_HOST;
}

const account = {
    configured: !!FIREBASE_API_KEY, base: accountBase(),
    user: null,      // { uid, email } while signed in
    profile: null,   // { name, rating, matches, wins, losses, pointsFor, pointsAgainst, settings, skin } once the server has answered (null = signed in but no name yet)
    loading: false, error: '',
    idToken: null, expiresAt: 0, lastPushed: null, listeners: [],
    changed() { for (const f of this.listeners) f(); },

    async fb(url, body) { // one call to Firebase Auth
        const r = await fetch(url + '?key=' + FIREBASE_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok)
            throw new Error(FB_ERRORS[String((j.error && j.error.message) || '').split(' ')[0]] || 'Could not do that. Try again.');
        return j;
    },
    startSession(idToken, refreshToken, expiresIn, uid, email) {
        this.idToken = idToken;
        this.expiresAt = Date.now() + (Number(expiresIn) - 60) * 1000;
        this.user = { uid, email: email || (this.user && this.user.email) || '' };
        try { localStorage.setItem(ACCOUNT_STORE, JSON.stringify({ refreshToken, uid, email: this.user.email })); } catch (e) {}
    },
    async signUp(email, password) {
        const j = await this.fb('https://identitytoolkit.googleapis.com/v1/accounts:signUp', { email, password, returnSecureToken: true });
        this.startSession(j.idToken, j.refreshToken, j.expiresIn, j.localId, j.email);
        await this.loadProfile();
    },
    async signIn(email, password) {
        const j = await this.fb('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', { email, password, returnSecureToken: true });
        this.startSession(j.idToken, j.refreshToken, j.expiresIn, j.localId, j.email);
        await this.loadProfile();
    },
    async reset(email) { await this.fb('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); },
    signOut() {
        this.user = this.profile = this.idToken = null;
        this.error = '';
        try { localStorage.removeItem(ACCOUNT_STORE); sessionStorage.removeItem('wdb-synced'); } catch (e) {}
        this.changed();
    },
    async freshToken() { // a valid sign-in token (refreshing it when it is about to expire), or null for a guest
        if (!this.configured)
            return null;
        if (this.idToken && Date.now() < this.expiresAt)
            return this.idToken;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(ACCOUNT_STORE)); } catch (e) {}
        if (!saved || !saved.refreshToken)
            return null;
        try {
            const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }).toString() });
            if (r.status === 400) { // the sign-in was revoked, or is too old
                this.signOut();
                return null;
            }
            if (!r.ok)
                return null;
            const j = await r.json();
            this.startSession(j.id_token, j.refresh_token, j.expires_in, j.user_id, saved.email);
            return this.idToken;
        } catch (e) {
            return null; // offline: carry on as a guest for now
        }
    },
    async api(path, method = 'GET', body) { // a call to the game server with your token
        const token = await this.freshToken();
        if (!token)
            throw new Error('Please sign in.');
        const r = await fetch(this.base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401)
            this.signOut();
        if (!r.ok)
            throw new Error(j.error || 'Something went wrong.');
        return j;
    },
    async loadProfile() {
        this.loading = true;
        this.error = '';
        this.changed();
        try {
            this.profile = (await this.api('/api/me')).profile;
            if (this.profile)
                this.pullSettings();
        } catch (e) {
            this.error = e.message;
        }
        this.loading = false;
        this.changed();
    },
    async setName(name) { // first call creates the profile
        const first = !this.profile;
        this.profile = (await this.api('/api/name', 'POST', { name })).profile;
        if (first)
            this.pushSettings(); // a new account keeps this device's settings
        this.changed();
        if (typeof net !== 'undefined' && net.refreshIdentity)
            net.refreshIdentity(); // a room you are already in learns the new name
    },
    async saveSkin(skin, slot) {
        const r = await this.api('/api/skin', 'POST', { skin, slot });
        Object.assign(this.profile, { skin: r.skin, skins: r.skins, slot: r.slot });
        this.changed();
        return r.skin;
    },
    async selectSkinSlot(slot) {
        const r = await this.api('/api/skin-slot', 'POST', { slot });
        Object.assign(this.profile, { skin: r.skin, skins: r.skins, slot: r.slot });
        this.changed();
    },

    // ---- settings that follow the account ----
    localSettings() {
        const o = {};
        for (const k of SYNC_KEYS)
            try { const v = localStorage.getItem(k); if (v !== null) o[k] = v; } catch (e) {}
        return o;
    },
    pullSettings() { // on sign-in / page load: this device takes the account's settings (first time on an account: the account takes this device's)
        const s = (this.profile && this.profile.settings) || {};
        if (!Object.keys(s).length) {
            this.pushSettings();
            return;
        }
        const mine = this.localSettings();
        if (SYNC_KEYS.some(k => (k in s ? s[k] : null) !== (k in mine ? mine[k] : null))) {
            let synced = false;
            try { synced = !!sessionStorage.getItem('wdb-synced'); } catch (e) {}
            if (!synced) { // apply them and reload once so every part of the game reads them fresh
                try {
                    for (const k of SYNC_KEYS)
                        if (k in s) localStorage.setItem(k, s[k]); else localStorage.removeItem(k);
                    sessionStorage.setItem('wdb-synced', '1');
                } catch (e) {}
                location.reload();
                return;
            }
            this.lastPushed = null; // still different after a reload: this device wins, push it up
            return;
        }
        this.lastPushed = JSON.stringify(mine);
    },
    pushSettings() {
        const now = this.localSettings();
        this.lastPushed = JSON.stringify(now);
        this.api('/api/settings', 'POST', { settings: now }).catch(() => { this.lastPushed = null; }); // (retried by the timer below)
    },
    init() {
        if (!this.configured)
            return;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(ACCOUNT_STORE)); } catch (e) {}
        if (saved && saved.refreshToken) {
            this.user = { uid: saved.uid, email: saved.email };
            this.loadProfile();
        }
        const dirty = () => this.profile && JSON.stringify(this.localSettings()) !== this.lastPushed;
        setInterval(() => { if (dirty()) this.pushSettings(); }, 8000); // settings changes reach the account within seconds
        document.addEventListener('visibilitychange', () => { if (document.hidden && dirty()) this.pushSettings(); });
    }
};
account.init();