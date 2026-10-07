// MUSIC - procedural "techno x oriental" background loop, synthesized live with Web Audio (no audio files).
// Touhou-style: 160 BPM, four-on-the-floor kick, rolling acid bass, fast arps, koto-like plucks, then a saw lead.
// Key: A, using a miyako-bushi flavour (A Bb D E F) so the Bb->A and F->E half-steps give the "eastern" sound.
// The loop is 16 bars (~24 s). A look-ahead scheduler keeps stepping through it forever, so it never has a gap,
// and reverb / delay tails ring straight across the loop point.
// Self-contained: touches nothing in physics/ game/ or render/. Press M or use the Music button to mute.
const Music = (() => {
    const BPM = 160, STEP = 60 / BPM / 4;        // one 16th note, in seconds
    const STEPS = 256;                           // 16 bars x 16 steps = one loop
    const AHEAD = 0.3, TICK = 50;                // schedule 0.3 s ahead, check every 50 ms
    const LEVEL = 0.38;                          // master volume (it's background music)
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    // ---- harmony: each chord lasts 2 bars (32 steps); 8 chords per loop ----
    const CH = {
        Am: { root: 45, arp: [69, 72, 76, 81], pad: [57, 60, 64] },
        Bb: { root: 46, arp: [70, 74, 77, 82], pad: [58, 62, 65] },
        F:  { root: 41, arp: [65, 69, 72, 77], pad: [53, 57, 60] },
        E:  { root: 40, arp: [64, 71, 76, 77], pad: [52, 59, 64] },  // E with a flat-9 (F): very phrygian
        Dm: { root: 38, arp: [65, 69, 74, 77], pad: [50, 57, 62] },
    };
    const SLOTS = ['Am', 'Bb', 'F', 'E', 'Am', 'Bb', 'Dm', 'E'];
    const ARP = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1];   // which chord tone each 16th plays

    // ---- melody phrases: [step within the 2-bar chord slot, midi note, length in steps] ----
    const S1 = [[0,81,3],[4,84,3],[8,88,4],[12,86,2],[14,84,2],[16,81,4],[20,79,2],[22,81,2],[24,84,6],[30,81,2]];
    const S2 = [[0,82,3],[4,86,3],[8,89,4],[12,86,2],[14,82,2],[16,81,4],[20,82,2],[22,86,2],[24,89,6],[30,86,2]];
    const S3 = [[0,84,3],[4,81,3],[8,77,4],[12,81,2],[14,84,2],[16,89,4],[20,88,2],[22,84,2],[24,81,6],[30,84,2]];
    const S4 = [[0,83,3],[4,88,3],[8,89,2],[10,88,2],[12,83,4],[16,76,2],[18,83,2],[20,88,4],[24,89,2],[26,88,2],[28,83,2],[30,82,2]];
    const S7 = [[0,86,3],[4,89,3],[8,93,4],[12,89,2],[14,86,2],[16,81,4],[20,86,2],[22,89,2],[24,86,6],[30,84,2]];
    const S8 = [[0,83,3],[4,88,3],[8,89,2],[10,88,2],[12,83,4],[16,76,2],[18,83,2],[20,88,4],[24,89,1],[25,88,1],[26,86,1],[27,84,1],[28,83,1],[29,82,1],[30,81,2]];
    // first half of the loop: the long notes of the melody as koto plucks; second half: full saw lead
    const PLUCK = [S1, S2, S3, S4].map(p => p.filter(n => n[2] >= 3));
    const LEAD = [S1, S2, S7, S8];

    // ---- audio graph state ----
    let ctx = null, master, duck, revIn, dlyIn, noiseBuf;
    let enabled = true, step = 0, nextT = 0, timer = null;
    try { enabled = localStorage.getItem('wdb-music') !== '0'; } catch (e) {}

    function init() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
        master = ctx.createGain(); master.gain.value = 0;
        master.connect(comp); comp.connect(ctx.destination);
        duck = ctx.createGain();                       // sidechain-style pump: pads and arps dip on every kick
        duck.connect(master);
        // reverb: generated noise impulse response
        const len = Math.floor(ctx.sampleRate * 2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        const conv = ctx.createConvolver(); conv.buffer = ir;
        revIn = ctx.createGain();
        const revOut = ctx.createGain(); revOut.gain.value = 0.45;
        revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
        // dotted-eighth feedback delay
        const dly = ctx.createDelay(1); dly.delayTime.value = STEP * 3;
        const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
        const fb = ctx.createGain(); fb.gain.value = 0.36;
        const dlyOut = ctx.createGain(); dlyOut.gain.value = 0.5;
        dlyIn = ctx.createGain();
        dlyIn.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(dlyOut); dlyOut.connect(master);
        // shared white noise for hats / claps
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        nextT = ctx.currentTime + 0.15;
        step = 0;
        timer = setInterval(schedule, TICK);
    }

    // ---- instruments ----
    function voice(o) {
        const { t, dur, freq, type = 'sawtooth', vol = 0.1, a = 0.005, r = 0.05, cut, cutEnd, cd, q = 1,
                dest = master, rev = 0, dly = 0, det = 0, vib = 0 } = o;
        const osc = ctx.createOscillator();
        osc.type = type; osc.frequency.value = freq; osc.detune.value = det;
        const g = ctx.createGain(), hold = t + Math.max(a, dur), end = hold + r;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + a);
        g.gain.setValueAtTime(vol, hold);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        let n = osc;
        if (cut) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.Q.value = q;
            f.frequency.setValueAtTime(cut, t);
            if (cutEnd) f.frequency.exponentialRampToValueAtTime(cutEnd, t + (cd || dur));
            osc.connect(f); n = f;
        }
        n.connect(g); g.connect(dest);
        if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(revIn); }
        if (dly) { const s = ctx.createGain(); s.gain.value = dly; g.connect(s); s.connect(dlyIn); }
        if (vib) {
            const l = ctx.createOscillator(), lg = ctx.createGain();
            l.frequency.value = 5.5; lg.gain.value = vib;
            l.connect(lg); lg.connect(osc.detune);
            l.start(t); l.stop(end + 0.05);
        }
        osc.start(t); osc.stop(end + 0.05);
    }
    function noise(t, len, type, freq, vol, q = 0.7, dest = master) {
        const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
    }
    function kick(t) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(170, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.95, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.32);
        duck.gain.cancelScheduledValues(t);
        duck.gain.setValueAtTime(0.25, t);
        duck.gain.linearRampToValueAtTime(1, t + 0.2);
    }
    const hat = (t, vol, len) => noise(t, len, 'highpass', 7500, vol, 0.7);
    const clap = (t, vol) => { noise(t - 0.012, 0.03, 'bandpass', 1700, vol * 0.6, 0.8); noise(t, 0.16, 'bandpass', 1700, vol, 0.8); };
    function taiko(t, vol) {   // big drum hit: the "oriental" low end
        const o = ctx.createOscillator(), g = ctx.createGain(), s = ctx.createGain();
        o.frequency.setValueAtTime(135, t);
        o.frequency.exponentialRampToValueAtTime(58, t + 0.18);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        s.gain.value = 0.3;
        o.connect(g); g.connect(master); g.connect(s); s.connect(revIn);
        o.start(t); o.stop(t + 0.5);
        noise(t, 0.05, 'lowpass', 900, vol * 0.5, 0.7);
    }

    // ---- one 16th-note step of the song ----
    function playStep(s, t) {
        const st = s & 15, bar = s >> 4, slot = s >> 5, ss = s & 31, second = slot >= 4;
        const chord = CH[SLOTS[slot]];

        // drums
        if (st % 4 === 0) kick(t);
        if (st % 4 === 2) hat(t, 0.1, 0.13);
        else if (st & 1) hat(t, 0.035, 0.04);
        if (st === 4 || st === 12) clap(t, 0.32);
        if (bar % 4 === 3 && st >= 12) clap(t, 0.12 + (st - 12) * 0.06);        // snare-roll fill every 4 bars
        if (second && (st === 0 && bar % 2 === 0 || st === 10)) taiko(t, 0.4);
        if (!second && st === 0 && bar % 4 === 0) taiko(t, 0.25);

        // rolling acid bass on the off-16ths, filter slowly breathing
        if (st % 4 !== 0) {
            const cut = 260 + 900 * (0.5 + 0.5 * Math.sin(s / STEPS * Math.PI * 8));
            voice({ t, freq: mtof(chord.root + (st % 4 === 2 ? 12 : 0)), vol: 0.17, a: 0.003, dur: STEP * 0.7, r: 0.03,
                    cut, cutEnd: cut * 0.35, q: 6 });
        }

        // fast arpeggio (pumping with the kick)
        voice({ t, freq: mtof(chord.arp[ARP[st] % chord.arp.length]), type: 'square', vol: second ? 0.04 : 0.032,
                a: 0.004, dur: STEP * 0.55, r: 0.06, cut: 3400, cutEnd: 1100, q: 2, dest: duck, rev: 0.15, dly: 0.35 });

        // pad: one long chord per slot
        if (ss === 0) {
            for (const m of chord.pad) for (const d of [-9, 9])
                voice({ t, freq: mtof(m), vol: 0.03, a: 0.5, dur: STEP * 30, r: 0.7, cut: 1400, q: 0.7, dest: duck, rev: 0.4, det: d });
        }

        // melody
        if (!second) {                                   // koto-like plucks
            for (const [ns, m, len] of PLUCK[slot]) if (ns === ss)
                voice({ t, freq: mtof(m), vol: 0.13, a: 0.002, dur: 0.02, r: 0.5, cut: 4200, cutEnd: 500, cd: 0.4, q: 1.5, rev: 0.35, dly: 0.4 });
        } else {                                         // saw lead with vibrato
            for (const [ns, m, len] of LEAD[slot - 4]) if (ns === ss)
                for (const d of [-7, 7])
                    voice({ t, freq: mtof(m), vol: 0.04, a: 0.01, dur: len * STEP * 0.95, r: 0.09, cut: 3800, q: 1.2,
                            rev: 0.3, dly: 0.3, det: d, vib: 10 });
        }
    }

    function schedule() {
        while (nextT < ctx.currentTime + AHEAD) {
            playStep(step % STEPS, nextT);
            nextT += STEP;
            step++;
        }
    }

    // ---- on/off ----
    function apply() {
        if (!ctx) return;
        if (enabled) {
            ctx.resume();
            master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.08);
        } else {
            master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            setTimeout(() => { if (!enabled) ctx.suspend(); }, 400);
        }
    }
    function label() {
        const b = document.getElementById('music');
        if (!b) return;
        b.textContent = '\u266A Music: ' + (enabled ? 'On' : 'Off');
        b.classList.toggle('on', enabled);
    }
    function toggle() {
        enabled = ctx ? !enabled : true;                 // before the first start, a click/M means "start it"
        try { localStorage.setItem('wdb-music', enabled ? '1' : '0'); } catch (e) {}
        if (enabled && !ctx) init();
        apply();
        label();
    }

    // Browsers only allow audio after a user gesture, so start on the first key press or click.
    function firstGesture(e) {
        if ((e.target && e.target.id === 'music') || e.key === 'm' || e.key === 'M') return;   // those toggle by themselves
        if (!enabled) return;
        window.removeEventListener('keydown', firstGesture);
        window.removeEventListener('pointerdown', firstGesture);
        if (!ctx) init();
        apply();
    }
    window.addEventListener('keydown', firstGesture);
    window.addEventListener('pointerdown', firstGesture);
    window.addEventListener('keydown', e => { if (!e.repeat && (e.key === 'm' || e.key === 'M')) toggle(); });
    const btn = document.getElementById('music');
    if (btn) btn.addEventListener('click', () => { toggle(); const c = document.getElementById('c'); if (c) c.focus(); });
    document.addEventListener('visibilitychange', () => {       // timers are throttled in hidden tabs, so just pause
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume();
    });
    label();

    return { toggle, get enabled() { return enabled; } };
})();
