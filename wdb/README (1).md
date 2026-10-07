# Weird Death Ball

Open `index.html` in a browser (no server or build step needed). Click the game once so it gets keyboard focus.

## Layout

```
index.html            page markup + script tags (the load order matters, see below)
css/style.css
js/
  physics/            the simulation: no drawing, no DOM
    constants.js        arena size and every tuning number
    terrain.js          static geometry (slopes, juts, tunnels, hatchets) + the seesaw floor
    collision.js        circle-vs-segment, circle-vs-circle, rolling friction, hatchet / peg bounce
    ball.js             Ball (the death ball and decoys)
    player.js           Player: movement, grapple rope, dash / plinko / marionette / decoy
    bodies.js           the actual players, ball, pegs and decoys
  game/               rules on top of the physics: still no drawing
    rules.js            score, rounds, kills, the fixed-step update(), `events` hooks
    ai.js               computer opponent (plans by simulating the real physics)
  render/             canvas drawing: read-only on game state
    canvas.js           canvas handle + shared drawing constants
    hud.js              score bars along the top
    trail.js            ball speed lines
    special-menu.js     special-ability dropdown (+ hit testing)
    key-hints.js        key caps beside each goal
    arena.js            background, floor, goals, tunnels, hatchets, net
    entities.js         pegs, casts, ropes, players, balls, banner
    render.js           draw(): one frame, back to front
  input.js            keyboard, AI toggle buttons, menu clicks
  main.js             wires render -> game events, runs the 120 Hz loop
```

Scripts are plain `<script>` tags (not ES modules) so the game also works when opened straight from disk.
Everything shares one global scope, so a file can only use things from files listed above it in `index.html`
(or things it only touches at runtime, after everything has loaded).

## The one rule

`physics/` and `game/` never reference anything in `render/`. The renderer reaches into the simulation to read it,
and the simulation reaches the renderer only through the `events` object in `game/rules.js`:

| hook | when | renderer does (see `main.js`) |
| --- | --- | --- |
| `onPoint(team, why)` | a point is awarded | flash the score bar / threshold line |
| `onBodyStep(b)` | a player or ball advanced one physics step | record a speed-line sample |
| `onPauseTick()` | each step of the between-rounds pause | melt the streaks |
| `onNewRound()` | round reset | clear the death ball's streak |

Because of that, you can run the game headless (e.g. for AI training or tests) by loading only `js/physics/*` and `js/game/*`.

Two small, deliberate exceptions: `padFlash` (terrain.js) is the hatchet's "just hit" glow, set by physics and faded by
the HUD, and `ball.pull` / `player.dashT` are effect timers the physics sets and the renderer reads.

## What changed from the single file

- Split into the modules above. Behavior is unchanged: I ran the original and this version side by side on the same
  random seed (AI vs AI, plus randomized key mashing with every special ability) and compared the simulation state
  every 150 steps and every canvas draw call. They matched exactly.
- `draw()` (about 235 lines) is now a short list of calls: `drawArena`, `drawPegs`, `drawCasts`, `drawRopes`, and so on.
- The renderer no longer writes into physics objects: decoy streaks live in a `WeakMap` in `trail.js` instead of on the
  decoy, and `p.ropeShown` (written, never read) is gone.
- The AI's repeated "save the effect values, run the rollout, restore them" block is now `snapshotFx()` / `restoreFx()`.
- Removed dead code: `RAMP_L`, `RAMP_R`, `PAD_MIN_HIT`, `prevUp`, `prevZ`.
- Small naming fixes: `k_held` -> `anyArrowHeld`; the local `KS` in the key hints (which shadowed the rope stiffness
  `KS`) -> `KEY`; the R-key reset logic is now `resetMatch()`.

## Where to add things

- New ability: tuning in `physics/constants.js`, behavior in `Player.step`, icon in `render/key-hints.js`
  (`iconGlyph`), entry in `SPECIALS` in `render/special-menu.js`, in-progress visuals in `drawCasts`.
- New terrain: geometry in `physics/terrain.js` (add segments to `SEGS`), drawing in `render/arena.js`.
- New visual effect: add a `draw...` function in `render/`, call it from `draw()`; if it needs a game event, add a hook to `events`.

## Gameplay notes

- **Crash shot:** touching the death ball still kills a player, but first `crashShot()` (physics/collision.js) hands the ball the
  player's momentum, so it flies the way the player was moving. Tune with `PLAYER_M` and `CRASH_TRANSFER` in `physics/constants.js`
  (1 = all of it; with the ball at a quarter of a player's mass that is 4x the player's speed). Hits above the normal ball speed cap
  raise the cap briefly, like a hatchet hit. Decoys keep their existing solid-body bounce against players.
- **Streaks:** the death ball's are violet; each player's use their team color (`trailTint` in render/trail.js).
- **2v2:** the `2v2` button (or `T`) adds a second player per team. In 2v2 each team's first player spawns 2 player lengths from the ball and
  the second 2 player lengths from the goal scoop (`SPAWN_BALL_D`, `SPAWN_SCOOP_D` in physics/bodies.js). Teammates start as AI; switch them to
  Human with their buttons or keys 3 / 4 (Blue 2: IJKL + U/O/P, Red 2: numpad 8/4/5/6 + 7/9/0). A team is out when all its players are dead.
  Plinko pegs and decoys are limited per player, not per team. Teammates use Dash (the special menu only covers the first two players).
