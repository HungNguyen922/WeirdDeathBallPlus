// MUSIC - plays the BeepBox song in song-data.js (SONG) through the same live Web Audio synth as before.
// Load order in your HTML:  <script src="song-data.js"></script>  then  <script src="music.js"></script>
// To change the song: edit it in BeepBox, export .mid, run  python midi_to_song.py song.mid > song-data.js
// To change how each channel SOUNDS: edit PARTS and DRUMS below.
// A look-ahead scheduler keeps stepping through the loop forever, so there is no gap and reverb / delay tails
// ring straight across the loop point. Press M or use the Music button to mute.
const Music = (() => {
    const BPM = SONG.bpm, STEP = 60 / BPM / 4;   // one 16th note, in seconds (BPM comes from the BeepBox file)
    const BAR = 16, STEPS = SONG.bars * BAR;     // steps per bar / steps in the whole loop
    const AHEAD = 0.3, TICK = 50;                // schedule 0.3 s ahead, check every 50 ms
    const LEVEL = 0.38;                          // master volume (it's background music)
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

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
        buildEvents();
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

    // ---- what each BeepBox channel sounds like: (time, midi note, length in steps) ----
    // Names match the channel names in song-data.js. Delete a line to mute that channel.
    const PARTS = {
        // slow melody: koto-like pluck (length is ignored, the pluck just rings out)
        pitch1: (t, m, len) => voice({ t, freq: mtof(m), vol: 0.13, a: 0.002, dur: 0.02, r: 0.5, cut: 4200, cutEnd: 500, cd: 0.4, q: 1.5, rev: 0.35, dly: 0.4 }),
        // fast arpeggio: square wave, pumping with the kick
        pitch2: (t, m, len) => voice({ t, freq: mtof(m), type: 'square', vol: 0.035, a: 0.004, dur: len * STEP * 0.55, r: 0.06, cut: 3400, cutEnd: 1100, q: 2, dest: duck, rev: 0.15, dly: 0.35 }),
        // bouncing low line: acid-style saw bass
        pitch3: (t, m, len) => voice({ t, freq: mtof(m), vol: 0.15, a: 0.003, dur: len * STEP * 0.7, r: 0.03, cut: 900, cutEnd: 300, q: 6 }),
        // mid bass arpeggio: softer saw
        pitch4: (t, m, len) => voice({ t, freq: mtof(m), vol: 0.1, a: 0.004, dur: len * STEP * 0.8, r: 0.05, cut: 1500, cutEnd: 500, q: 2 }),
        // chords: detuned pad, pumping with the kick
        pitch5: (t, m, len) => { for (const d of [-9, 9]) voice({ t, freq: mtof(m), vol: 0.03, a: 0.5, dur: len * STEP * 0.95, r: 0.7, cut: 1400, q: 0.7, dest: duck, rev: 0.4, det: d }); },
        // lead: detuned saws with vibrato
        pitch6: (t, m, len) => { for (const d of [-7, 7]) voice({ t, freq: mtof(m), vol: 0.04, a: 0.01, dur: len * STEP * 0.95, r: 0.09, cut: 3800, q: 1.2, rev: 0.3, dly: 0.3, det: d, vib: 10 }); },
    };
    // drum notes from the BeepBox noise channel (GM numbers): (time)
    const DRUMS = {
        36: t => kick(t),
        40: t => clap(t, 0.32),
        46: t => hat(t, 0.1, 0.13),     // the off-beat tick
        55: t => hat(t, 0.06, 0.05),    // steady 8th-note hat
    };

    // ---- turn SONG into a per-step event list (done once) ----
    const events = [];
    function buildEvents() {
        for (let s = 0; s < STEPS; s++) events[s] = [];
        for (const name in SONG.tracks) {
            if (!PARTS[name]) continue;
            SONG.tracks[name].forEach((bar, b) => {
                for (const [st, m, len] of bar) {
                    const s = b * BAR + st;
                    if (s < STEPS) events[s].push(t => PARTS[name](t, m, len));
                }
            });
        }
        for (const n in SONG.drums) {
            if (!DRUMS[n]) continue;
            for (const s of SONG.drums[n]) if (s < STEPS) events[s].push(DRUMS[n]);
        }
    }

    function schedule() {
        while (nextT < ctx.currentTime + AHEAD) {
            for (const ev of events[step % STEPS]) ev(nextT);
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
