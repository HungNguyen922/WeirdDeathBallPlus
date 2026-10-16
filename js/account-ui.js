// ACCOUNT TAB - the menu's Account panel: sign in / create an account, choose a name, your rating and record, and the leaderboard. Display only; the work is in net/account.js.
(function () {
    const root = document.getElementById('acct');
    if (!root)
        return;
    let renaming = false, board = null, boardMsg = '';
    const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

    // Typing in these boxes must not drive the game ('r' restarts, 'm' mutes, 1-4 toggle the AI...). Same trick as the chat box: stop the key travelling, never cancel what it types.
    for (const type of ['keydown', 'keyup', 'keypress'])
        window.addEventListener(type, e => {
            const t = e.target;
            if (t && t.closest && t.closest('#acct') && /^(INPUT|TEXTAREA)$/.test(t.tagName) && e.key !== 'Escape')
                e.stopPropagation();
        }, true);

    function signedOut() {
        const box = el('div', { className: 'group' }, el('h3', { textContent: 'Sign in' }));
        const form = el('form'), note = el('p', { className: 'hint' });
        const email = el('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', required: true });
        const pass = el('input', { type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'current-password', required: true, minLength: 6 });
        let mode = 'in', busy = false;
        const signIn = el('button', { type: 'submit', className: 'mode on', textContent: 'Sign in', onclick: () => { mode = 'in'; } });
        const create = el('button', { type: 'submit', className: 'mode', textContent: 'Create account', onclick: () => { mode = 'up'; } });
        form.onsubmit = async e => {
            e.preventDefault();
            if (busy)
                return;
            busy = true;
            note.textContent = 'Working... (the first request can take a minute if the server was asleep)';
            try { await (mode === 'up' ? account.signUp(email.value.trim(), pass.value) : account.signIn(email.value.trim(), pass.value)); } catch (err) { note.textContent = err.message; }
            busy = false;
        };
        const forgot = el('button', {
            type: 'button', className: 'mode', textContent: 'Forgot password',
            onclick: async () => {
                if (!email.value.trim()) { note.textContent = 'Type your email first.'; return; }
                try { await account.reset(email.value.trim()); note.textContent = 'Check your email for a reset link.'; } catch (err) { note.textContent = err.message; }
            }
        });
        form.append(email, pass, signIn, create, forgot);
        box.append(form, note, el('p', { className: 'hint', textContent: 'Your name, settings and rating follow you to any device. Ranked matches count when everyone seated is signed in. Playing without an account still works.' }));
        return box;
    }

    function nameForm(changing) {
        const box = el('div', { className: 'group' }, el('h3', { textContent: changing ? 'Change name' : 'Choose your name' }));
        const form = el('form'), note = el('p', { className: 'hint' });
        const input = el('input', { type: 'text', placeholder: '3-16 letters, numbers or _', maxLength: 16, autocomplete: 'off', value: changing ? account.profile.name : '' });
        form.onsubmit = async e => {
            e.preventDefault();
            note.textContent = '';
            try { await account.setName(input.value.trim()); renaming = false; render(); } catch (err) { note.textContent = err.message; }
        };
        form.append(input, el('button', { type: 'submit', className: 'mode on', textContent: 'Save' }));
        if (changing)
            form.append(el('button', { type: 'button', className: 'mode', textContent: 'Cancel', onclick: () => { renaming = false; render(); } }));
        box.append(form, note);
        return box;
    }

    function profileView() {
        const p = account.profile;
        const box = el('div', { className: 'group' }, el('h3', { textContent: p.name }));
        box.append(el('p', { className: 'hint', textContent: `Rating ${p.rating}   |   ${p.wins} wins, ${p.losses} losses (${p.matches} ranked matches)   |   points ${p.pointsFor} - ${p.pointsAgainst}` }));
        box.append(el('div', { className: 'row' },
            el('button', { className: 'mode', textContent: 'Change name', onclick: () => { renaming = true; render(); } }),
            el('button', { className: 'mode', textContent: 'Sign out', onclick: () => account.signOut() })));
        box.append(el('p', { className: 'hint', textContent: 'Signed in as ' + (account.user.email || '') + '. Keybinds, music, chat and floor-effects settings are saved to your account.' }));
        return box;
    }

    function boardView() {
        const box = el('div', { className: 'group' }, el('h3', { textContent: 'Leaderboard' }));
        if (!board) {
            box.append(el('p', { className: 'hint', textContent: boardMsg || 'Loading...' }));
            return box;
        }
        if (!board.length)
            box.append(el('p', { className: 'hint', textContent: 'No ranked matches yet.' }));
        else {
            const body = el('tbody');
            board.forEach((r, i) => body.append(el('tr', {}, el('td', { textContent: String(i + 1) }), el('td', { textContent: r.name }), el('td', { className: 'num', textContent: String(r.rating) }), el('td', { className: 'num', textContent: r.wins + '-' + r.losses }))));
            box.append(el('table', { className: 'keymap' }, el('thead', {}, el('tr', {}, el('th', { textContent: '#' }), el('th', { textContent: 'Name' }), el('th', { className: 'num', textContent: 'Rating' }), el('th', { className: 'num', textContent: 'W-L' }))), body));
        }
        box.append(el('div', { className: 'row' }, el('button', { className: 'mode', textContent: 'Refresh', onclick: loadBoard })));
        return box;
    }

    function render() {
        root.textContent = '';
        if (!account.configured) {
            root.append(el('p', { className: 'hint', textContent: 'Accounts are not set up on this copy of the game yet (paste the Firebase web API key into js/net/account.js).' }));
            return;
        }
        if (!account.user)
            root.append(signedOut());
        else if (account.loading)
            root.append(el('p', { className: 'hint', textContent: 'Loading your account... (the first request can take a minute if the server was asleep)' }));
        else if (account.error)
            root.append(el('p', { className: 'hint', textContent: account.error }), el('button', { className: 'mode', textContent: 'Try again', onclick: () => account.loadProfile() }), el('button', { className: 'mode', textContent: 'Sign out', onclick: () => account.signOut() }));
        else if (!account.profile)
            root.append(nameForm(false));
        else
            root.append(renaming ? nameForm(true) : profileView());
        root.append(boardView());
    }
    function loadBoard() {
        boardMsg = 'Loading...';
        fetch(account.base + '/api/leaderboard').then(r => r.json()).then(j => { board = j.rows || []; boardMsg = j.error || ''; }).catch(() => { boardMsg = 'Could not load the leaderboard.'; }).finally(render);
    }
    account.listeners.push(render);
    document.querySelector('[data-tab="account"]').addEventListener('click', () => { if (!board) loadBoard(); });
    render();
})();