// SKIN TAB - the menu's Skin panel: a preview of your player you can click and drag, shapes to add, presets (hats, mustaches, faces), and Save.
// Display and editing only: what a skin is lives in skin-data.js, how it is drawn in render/skin.js, and where it is stored in net/account.js (signed in) or this browser (guest).
(function () {
    const root = document.getElementById('skinedit');
    if (!root)
        return;
    const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const SHAPE_NAMES = { oval: 'Circle', rect: 'Box', tri: 'Triangle', half: 'Dome', star: 'Star', heart: 'Heart', ring: 'Ring', moon: 'Crescent', cross: 'Plus' };
    const TEAMS = [{ name: 'Blue', color: typeof BLUE !== 'undefined' ? BLUE : '#42a5f5' }, { name: 'Red', color: typeof RED !== 'undefined' ? RED : '#ef5350' }];
    const CV = 360, U = 60; // preview canvas size (px) and pixels per player radius

    // Keys typed into sliders, colour pickers and drop-downs here must not drive the game (the arrow keys would move your player). Same trick as the account tab.
    for (const type of ['keydown', 'keyup', 'keypress'])
        window.addEventListener(type, e => {
            const t = e.target;
            if (t && t.closest && t.closest('#skinedit') && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && e.key !== 'Escape')
                e.stopPropagation();
        }, true);

    // ---- presets: ready-made groups of layers (x, y, w, h in player radii, r in degrees, o = outside) ----
    const L = (t, x, y, w, h, r, c, o) => ({ t, x, y, w, h, r, c, o: o ? 1 : 0 });
    const PRESETS = [
        { name: 'Top hat', layers: [L('rect', 0, -1.47, 0.5, 0.4, 0, '#222222', 1), L('rect', 0, -0.98, 0.78, 0.09, 0, '#222222', 1), L('rect', 0, -1.15, 0.5, 0.07, 0, '#c62828', 1)] },
        { name: 'Party hat', layers: [L('tri', 0.05, -1.5, 0.42, 0.62, 12, '#e91e63', 1), L('oval', 0.25, -2.1, 0.13, 0.13, 0, '#ffeb3b', 1)] },
        { name: 'Crown', layers: [L('rect', 0, -1.05, 0.55, 0.14, 0, '#ffc107', 1), L('tri', -0.4, -1.4, 0.16, 0.26, 0, '#ffc107', 1), L('tri', 0, -1.45, 0.16, 0.32, 0, '#ffc107', 1), L('tri', 0.4, -1.4, 0.16, 0.26, 0, '#ffc107', 1)] },
        { name: 'Horns', layers: [L('tri', -0.62, -1.05, 0.2, 0.42, -28, '#b71c1c', 1), L('tri', 0.62, -1.05, 0.2, 0.42, 28, '#b71c1c', 1)] },
        { name: 'Cat ears', layers: [L('tri', -0.62, -0.95, 0.28, 0.3, -20, '#8d6e63', 1), L('tri', 0.62, -0.95, 0.28, 0.3, 20, '#8d6e63', 1)] },
        { name: 'Halo', layers: [L('ring', 0, -1.4, 0.5, 0.14, 0, '#ffee58', 1)] },
        { name: 'Mustache', layers: [L('moon', -0.3, 0.22, 0.2, 0.36, -80, '#3e2723', 1), L('moon', 0.3, 0.22, 0.2, 0.36, 80, '#3e2723', 1)] },
        { name: 'Monocle', layers: [L('ring', 0.4, -0.12, 0.3, 0.3, 0, '#ffc107', 1), L('rect', 0.7, 0.52, 0.05, 0.4, -12, '#ffc107', 1)] },
        { name: 'Eyes', layers: [L('oval', -0.3, -0.18, 0.2, 0.26, 0, '#ffffff', 0), L('oval', 0.3, -0.18, 0.2, 0.26, 0, '#ffffff', 0), L('oval', -0.26, -0.15, 0.09, 0.12, 0, '#111111', 0), L('oval', 0.34, -0.15, 0.09, 0.12, 0, '#111111', 0)] },
        { name: 'Smile', layers: [L('half', 0, 0.35, 0.42, 0.42, 180, '#222222', 0)] },
        { name: 'Stripes', layers: [L('rect', 0, -0.6, 1.2, 0.14, 0, '#ffffff', 0), L('rect', 0, 0, 1.2, 0.14, 0, '#ffffff', 0), L('rect', 0, 0.6, 1.2, 0.14, 0, '#ffffff', 0)] },
        { name: 'Target', layers: [L('oval', 0, 0, 0.8, 0.8, 0, '#ffffff', 0), L('oval', 0, 0, 0.55, 0.55, 0, '#d32f2f', 0), L('oval', 0, 0, 0.3, 0.3, 0, '#ffffff', 0)] }
    ];

    // ---- state ----
    let layers = [], sel = -1, team = 0, base = '[]', msg = '', drag = null;
    const mine = () => skinMy().map(l => ({ ...l }));
    const snapshot = () => JSON.stringify(skinClean(layers));
    const dirty = () => snapshot() !== base;
    function load() { layers = mine(); sel = layers.length - 1; base = snapshot(); }
    load();

    // ---- the preview ----
    const cv = el('canvas', { id: 'skincv', width: CV, height: CV, title: 'Click a shape to select it, drag to move it' }), c = cv.getContext('2d');
    function draw() {
        const col = TEAMS[team].color, clean = skinClean(layers);
        c.clearRect(0, 0, CV, CV);
        c.fillStyle = '#14181d'; c.fillRect(0, 0, CV, CV);
        c.save();
        c.translate(CV / 2, CV / 2);
        c.fillStyle = col; c.beginPath(); c.arc(0, 0, U, 0, 7); c.fill();
        skinPaint(c, clean, U, col, 'inner');
        c.strokeStyle = '#fff'; c.lineWidth = 2 * U / 16; c.beginPath(); c.arc(0, 0, U, 0, 7); c.stroke();
        skinPaint(c, clean, U, col, 'outer');
        if (layers[sel]) { // dashed outline round the selected shape (layers that cannot be drawn, e.g. a bad colour, are skipped by skinClean, so use the raw layer here)
            const l = skinClean([layers[sel]])[0];
            if (l) {
                c.save(); skinLayerPath(c, l, U); c.restore();
                c.setLineDash([5, 4]); c.lineWidth = 2; c.strokeStyle = '#ffd54a'; c.stroke(); c.setLineDash([]);
            }
        }
        c.restore();
    }
    function pointerLocal(e) { // pointer position in canvas pixels
        const r = cv.getBoundingClientRect();
        return { x: (e.clientX - r.left) * CV / r.width, y: (e.clientY - r.top) * CV / r.height };
    }
    function hit(px, py) { // the topmost layer under the pointer (small shapes also count when the pointer is near their middle), or -1
        const clean = skinClean(layers);
        if (clean.length !== layers.length)
            return -1;
        for (let i = layers.length - 1; i >= 0; i--) {
            const l = clean[i];
            c.save(); c.translate(CV / 2, CV / 2); skinLayerPath(c, l, U); c.restore();
            const inside = c.isPointInPath(px, py, l.t === 'ring' ? 'evenodd' : 'nonzero');
            if (inside || Math.hypot(px - CV / 2 - l.x * U, py - CV / 2 - l.y * U) < 0.18 * U)
                return i;
        }
        return -1;
    }
    cv.addEventListener('pointerdown', e => {
        const q = pointerLocal(e), i = hit(q.x, q.y);
        sel = i;
        if (i >= 0) {
            drag = { dx: layers[i].x - (q.x - CV / 2) / U, dy: layers[i].y - (q.y - CV / 2) / U };
            try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        }
        rebuild();
    });
    cv.addEventListener('pointermove', e => {
        if (!drag || !layers[sel])
            return;
        const q = pointerLocal(e);
        layers[sel].x = clamp(Math.round(((q.x - CV / 2) / U + drag.dx) * 100) / 100, -SKIN_POS, SKIN_POS);
        layers[sel].y = clamp(Math.round(((q.y - CV / 2) / U + drag.dy) * 100) / 100, -SKIN_POS, SKIN_POS);
        draw();
    });
    const endDrag = () => { if (drag) { drag = null; rebuild(); } };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);

    // ---- the controls ----
    const addLayers = ls => {
        if (layers.length + ls.length > SKIN_MAX_LAYERS) { msg = `A skin holds at most ${SKIN_MAX_LAYERS} layers.`; rebuild(); return; }
        layers.push(...ls.map(l => ({ ...l })));
        sel = layers.length - 1; msg = '';
        rebuild();
    };
    function slider(label, key, lo, hi, step, fmt) {
        const l = layers[sel], out = el('span', { className: 'val', textContent: fmt(l[key]) });
        const inp = el('input', { type: 'range', min: lo, max: hi, step, value: l[key] });
        inp.oninput = () => { l[key] = Number(inp.value); out.textContent = fmt(l[key]); draw(); updateButtons(); };
        inp.onchange = rebuild;
        return el('label', { className: 'srow' }, el('span', { textContent: label }), inp, out);
    }
    function move(from, to) { // change the drawing order of the selected layer
        if (to < 0 || to >= layers.length)
            return;
        layers.splice(to, 0, layers.splice(from, 1)[0]);
        sel = to; rebuild();
    }
    function controls() {
        const box = el('div', { className: 'skinctl' });
        const l = layers[sel];
        if (!l) {
            box.append(el('p', { className: 'hint', textContent: 'Click a shape on the preview (or in the list) to edit it, or add one below.' }));
            return box;
        }
        const shapes = el('div', { className: 'row' });
        for (const t of SKIN_SHAPES)
            shapes.append(el('button', { className: 'mode' + (l.t === t ? ' on' : ''), textContent: SHAPE_NAMES[t], onclick: () => { l.t = t; rebuild(); } }));
        const color = el('input', { type: 'color', value: l.c, title: 'Colour' });
        color.oninput = () => { l.c = color.value; draw(); updateButtons(); };
        color.onchange = rebuild;
        box.append(
            el('h3', { textContent: 'Selected shape' }), shapes,
            el('div', { className: 'row' }, el('label', { className: 'srow' }, el('span', { textContent: 'Colour' }), color),
                el('button', { className: 'mode' + (l.o ? ' on' : ''), textContent: l.o ? 'Outside the circle' : 'Inside the circle', title: 'Inside shapes are cut off at the edge of the circle (skins). Outside shapes can stick out (hats, horns, mustaches).', onclick: () => { l.o = l.o ? 0 : 1; rebuild(); } })),
            slider('Width', 'w', SKIN_SIZE_MIN, SKIN_SIZE_MAX, 0.01, v => v.toFixed(2)),
            slider('Height', 'h', SKIN_SIZE_MIN, SKIN_SIZE_MAX, 0.01, v => v.toFixed(2)),
            slider('Rotation', 'r', -180, 180, 1, v => v + '°'),
            el('div', { className: 'row' },
                el('button', { className: 'mode', textContent: 'Forward', onclick: () => move(sel, sel + 1) }),
                el('button', { className: 'mode', textContent: 'Back', onclick: () => move(sel, sel - 1) }),
                el('button', { className: 'mode', textContent: 'Copy', onclick: () => addLayers([{ ...l, x: clamp(l.x + 0.1, -SKIN_POS, SKIN_POS), y: clamp(l.y + 0.1, -SKIN_POS, SKIN_POS) }]) }),
                el('button', { className: 'mode', textContent: 'Mirror copy', title: 'A copy on the other side (for eyes, ears, horns)', onclick: () => addLayers([{ ...l, x: -l.x, r: -l.r }]) }),
                el('button', { className: 'mode', textContent: 'Delete', onclick: () => { layers.splice(sel, 1); sel = Math.min(sel, layers.length - 1); rebuild(); } })));
        return box;
    }
    function layerList() {
        const list = el('div', { className: 'skinlist' });
        if (!layers.length)
            list.append(el('p', { className: 'hint', textContent: 'No shapes yet: your player looks plain.' }));
        for (let i = layers.length - 1; i >= 0; i--) { // top of the list = drawn last = on top
            const l = layers[i], chip = el('span', { className: 'chip' });
            chip.style.background = l.c;
            list.append(el('button', { className: 'layer' + (i === sel ? ' sel' : ''), onclick: () => { sel = i; rebuild(); } }, chip, SHAPE_NAMES[l.t] + (l.o ? ' (outside)' : '')));
        }
        return list;
    }

    // ---- saving ----
    let saveBtn, revertBtn;
    function updateButtons() {
        if (saveBtn) saveBtn.disabled = !dirty();
        if (revertBtn) revertBtn.disabled = !dirty();
    }
    async function save() {
        const clean = skinClean(layers);
        skinSaveLocal(clean);
        layers = clean.map(l => ({ ...l }));
        sel = Math.min(sel, layers.length - 1);
        base = snapshot();
        if (account.user && account.profile) {
            msg = 'Saving...'; rebuild();
            try {
                await account.saveSkin(clean);
                msg = 'Saved to your account. Other players online will see it.';
                if (typeof net !== 'undefined' && net.on)
                    net.refreshIdentity();
            } catch (e) { msg = 'Saved on this device, but not to your account: ' + e.message; }
        } else
            msg = account.user ? 'Saved on this device. Choose a name on the Account tab to save it to your account.' : 'Saved on this device. Sign in on the Account tab so other players online can see it.';
        rebuild();
    }

    function rebuild() {
        root.textContent = '';
        const teamRow = el('div', { className: 'row' }, el('span', { className: 'hint', textContent: 'Preview as' }));
        TEAMS.forEach((t, i) => teamRow.append(el('button', { className: 'mode ' + (i ? 'red' : 'blue') + (team === i ? ' on' : ''), textContent: t.name, onclick: () => { team = i; draw(); rebuild(); } })));
        saveBtn = el('button', { className: 'mode on', textContent: 'Save', onclick: save });
        revertBtn = el('button', { className: 'mode', textContent: 'Revert', onclick: () => { load(); msg = ''; rebuild(); } });
        const shapesRow = el('div', { className: 'row' });
        for (const t of SKIN_SHAPES)
            shapesRow.append(el('button', { className: 'mode', textContent: '+ ' + SHAPE_NAMES[t], onclick: () => addLayers([L(t, 0, 0, 0.4, 0.4, 0, '#ffffff', 0)]) }));
        const presetRow = el('div', { className: 'row' });
        for (const p of PRESETS)
            presetRow.append(el('button', { className: 'mode', textContent: p.name, onclick: () => addLayers(p.layers) }));

        // left: the preview, which stays in view while you scroll the controls; right: everything you can change
        root.append(el('div', { className: 'skinwrap' },
            el('div', { className: 'skinleft' }, cv, teamRow,
                el('div', { className: 'row', style: 'margin-top:10px' }, saveBtn, revertBtn, el('button', { className: 'mode', textContent: 'Clear all', onclick: () => { layers = []; sel = -1; rebuild(); } })),
                el('p', { className: 'hint', textContent: msg || 'Inside shapes are cut off at the circle; outside ones can stick out like a hat. Your team colour always shows as a rim, so everyone can tell the teams apart. Online, only signed-in players show their skin to others.' })),
            el('div', { className: 'skinright' },
                el('div', { className: 'group' }, el('h3', { textContent: `Shapes (${layers.length} / ${SKIN_MAX_LAYERS}), top one is drawn last` }), layerList()),
                el('div', { className: 'group' }, controls()),
                el('div', { className: 'group' }, el('h3', { textContent: 'Add a shape' }), shapesRow, el('h3', { textContent: 'Or a ready-made one', style: 'margin-top:10px' }), presetRow))));
        updateButtons();
        draw();
    }

    // sign-in finished or the account answered: take the account's skin, unless there are unsaved edits
    account.listeners.push(() => { if (!dirty() && !drag) { load(); rebuild(); } });
    document.querySelector('[data-tab="skin"]').addEventListener('click', rebuild);
    rebuild();
})();
