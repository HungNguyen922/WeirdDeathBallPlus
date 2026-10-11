// PHYSICS - constants: arena size and every tuning number for players, ball, ropes and abilities.
// Units are 'u' (1 player length PL = 32 u). Nothing in here knows about drawing.
const W = 950, H = 600, NETX = W / 2;
const PL = 32; // one "player length" (diameter)
const RANGE = 4 * PL; // grapple reach
const RUN = 2 * PL, RISE = 0.75 * PL, PK = 5, NOTCH = 2; // slopes: 2 player lengths long, three quarters of a player tall; PK = half-gap between the middle peaks
const GOAL_Y1 = H - RISE, GOAL_Y0 = GOAL_Y1 - 6 * PL; // goal opening sits just above the goal ramps and is 6 player lengths tall; the jut above it reaches down to GOAL_Y0

const DT = 1 / 120; // fixed physics timestep (120 Hz)
const G = 410; // free-fall gravity (u/s^2): big arcs in the demo fall at ~320 px/s^2
const G_FLOAT = 90; // gravity while UP is held in the air: plain jumps are long, symmetric, floaty arcs
const JUMP_V = 150; // launch speed of a plain jump (u/s): ~88 u apex, ~2 s airtime with G_FLOAT
const DASH_V = 420, DASH_FX = 0.25; // dash impulse (u/s), streak lifetime (s)
const DOWN_G = 2.2; // gravity multiplier while DOWN is held (drop / fast-fall)
const RUN_ACC = 185; // ground acceleration (u/s^2): ~0 -> 270 u/s in ~1.5 s, roughly constant (no hard ramp)
const BALL_G = 170; // ball gravity (u/s^2): ~140 px/s^2 in the demo
const BALL_VMAX = 920; // ball speed cap (u/s): demo throws saturate at ~700-720 px/s
const BALL_PULL = 0.1; // share of the tether's pull the player feels (1 = original, 0 = weightless ball)
const BALL_TM = 0.7;  // ball mass as the tether sees it (higher = rope moves the ball less)
const HOOK_R = 3, BALL_M = 0.25, DAMP = 0.8; // platform rope damping

// Ball tether: a leash, the same elastic rope as on platforms (progressive spring, firmer with weight) but much stiffer, so the stretch stays small and the
// maximum length is enforced. BALL_RIGID = share of the outward speed the rope cancels outright; the spring takes the rest. Inside that length the rope is
// slack and does nothing: the ball and the player can move toward each other freely.
const KB = 150, DB = 0.6, BALL_RIGID = 0.6;
const TAUT_K = 110, TAUT_DAMP = 12, TAUT_MIN_NY = 0.5, TAUT_CENTER = 6, TAUT_DRAG = 3;
// Float vs dribble: a weighted kick on a floor pivot opens a DRIB_T s dribbling window that fades the float out (FLOAT_OFF_RATE, per s) so the rope can pull you in;
// afterwards it fades back in slowly (FLOAT_ON_RATE). Below the neutral float point there is a bob zone BOB_DEPTH u deep (+ BOB_KICK_BONUS right after a kick) where
// the float spring is only BOB_SOFT x as stiff, so a kick can sink you a little before the float catches you.
const DRIB_T = 0.45, FLOAT_OFF_RATE = 25, FLOAT_ON_RATE = 3;
const PRIME_T = 0.4; // how long (s) a weight press stays primed after release: grapple within this window and the kick fires on landing (held = always primed)
const BOB_DEPTH = 6, BOB_KICK_BONUS = 6, BOB_SOFT = 0.25;
const KS = 110; // surface-rope stiffness: firm, but stretches and recoils (elastic overshoot instead of a hard stop)
// Pivot transfer: when you come back down onto the floor right at a floor/slope pivot (within PIVOT_ZONE of it), the speed the floor would absorb is turned
// into sideways speed along the surface instead (PIVOT_TRANSFER = share of it; a rotation, so your speed is kept) and sends you out the other side.
const PIVOT_ZONE = 2 * PL, PIVOT_MIN_HIT = 60, PIVOT_TRANSFER = 0.85;
const LIFT_V = 280, WEIGHT_M = 1.4, WEIGHT_KICK = 300, MIN_LEN = 16; // grapple-jump lift, weight multiplier (lift), min surface tether; WEIGHT_KICK = impulse (u/s) away from the pivot each time weight is pressed while grappling
// Grapple-jump ramp. Chain: each grapple jump within GJ_CHAIN_T s of the last extends a chain; the kick is LIFT_V x min(GJ_MAX, GJ_START * GJ_GROWTH^n), n = jumps already in
// the chain, so spamming ramps it up exponentially. Ease: each kick is delivered over LIFT_RAMP s (smoothstep) instead of in one tick.
const GJ_START = 0.4, GJ_GROWTH = 1.1, GJ_MAX = 1, GJ_CHAIN_T = 1.5, LIFT_RAMP = 0.005;
const LIFT_SLACK = 0.15, LIFT_SLACK_W = 0.07; // extra tether length per unit of grapple-jump lift (normal / weighted)
const GRAPPLE_BURST_T = 0.7; // length (s) of the purple ripple when the grapple meter is overcharged
const GRAPPLE_MAX = 4, GRAPPLE_COOLDOWN = 6, GRAPPLE_REGEN = 1; // grapple meter: seconds of use before it is spent, the lockout (s) once it is, and refill speed (charge-seconds per second) while not gripping
const GROUND_DELAY = 0.1, HOOK_DELAY = 0.1; // the hook lands ~3 frames after the press, on the ground too (measured)
const HEAVY_KS = 1.0, STRETCH_X0 = 120, HOP_AIM = 0.5; // weight = a firmer rope; the rope stiffens as it stretches (x0 = stretch that doubles it); HOP_AIM = horizontal share of the grapple-jump kick // airborne surface grapples take ~3 video frames to land (measured), then kick away from the pivot

const PEG_R = PL/2, PEG_MAX = 2; // plinko peg: half a player's size (r 8 vs 16), bounce strength = the hatchet's (PAD_*), cooldown (s), pegs per player (placing a new one removes the oldest)
// Ability timing: cast = seconds from pressing the key until the effect happens; cd = cooldown (s) that starts when the effect happens, on top of each
// ability's own reset rule (dash: once per trip off the floor). PEG_LIFE = seconds a peg lasts before it fizzles out.
const DASH_CAST = 0.1, DASH_COOLDOWN = 5, PLINKO_CAST = DASH_CAST, PLINKO_COOLDOWN = 5, PEG_LIFE = 10;

// Marionette: hold the special key to aim (the arrow(s) are read live while it is held), release to shove the death ball that way. Releasing with no direction cancels it and spends
// nothing; letting go of the arrows up to MARIONETTE_GRACE s before the key still counts (so releasing both together does not lose your aim). A tap with an arrow held fires at
// once. The shove cancels the ball's motion against it first, like dash does. The cooldown starts when it fires.
// Decoy: a 1 s cast. At the end a lookalike ball appears where you stood when you pressed. It has the death ball's physics and can be grappled, thrown and scored with, but it
// never kills. Unlike the death ball it is also a solid body: it collides with players, the death ball and other decoys (DECOY_BOUNCE_*: 0 = dead stop, 1 = perfectly bouncy; the
// ball is light, BALL_M against a player's 1, so players knock it around). One per player: casting again (once DECOY_COOLDOWN has run out) removes the old one and puts a new
// one at the new spot. The cooldown starts when the decoy appears.
const MARIONETTE_GRACE = 0.1, MARIONETTE_COOLDOWN = 10, MARIONETTE_V = 500, MARIONETTE_FX = 0.3; // shove speed (u/s) added to the ball, length (s) of its streak effect

const DECOY_CAST = 1, DECOY_COOLDOWN = 20, DECOY_BOUNCE_PLAYER = 0.75, DECOY_BOUNCE_BALL = 0.8, DECOY_TELL = false; // DECOY_TELL: draw a dashed ring in the caster's color around the decoy (false = a perfect lookalike)

// Arrow: hold the special key to charge (ARROW_CHARGE_T s to full), release to fire along the aim. LEFT / RIGHT turn it at ARROW_TURN rad/s; a double tap within ARROW_DBL_T s snaps it.
// The death ball / decoys gain ARROW_BALL_K x the arrow's velocity; an enemy is knocked back by ARROW_KNOCK x it (ARROW_KILLS = true kills instead).
const ARROW_CHARGE_T = 1.2, ARROW_V_MIN = 300, ARROW_V_MAX = 1200, ARROW_G = G, ARROW_TURN = 2.2, ARROW_DBL_T = 0.25, ARROW_COOLDOWN = 2;
const ARROW_R = PL/4, ARROW_BALL_K = 0.6, ARROW_KNOCK = 0.75, ARROW_KILLS = false, ARROW_LIFE = 10, ARROW_STICK_T = 5;
const ARROW_LEN = PL, ARROW_HALF_W = PL/6, ARROW_SPENT_K = 0.15; // drawn length, half the drawn width (= collision thickness), share of speed a spent arrow keeps

// Bat: hold the special key to charge (BAT_CHARGE_T s to full; a tap is a weak swing), release to swing. The swing is a SEMICIRCLE (BAT_ARC rad) centred on the direction held
// (read live while charging, the last one held counts; none ever held = toward the death ball), so it can be tilted anywhere round the player. The bat starts at one end of the
// arc, sweeps through the aim and finishes at the other end (BAT_T s in all). It is only drawn, it is not a body. Every target (death ball, decoys, other players, teammates too if
// BAT_HITS_TEAMMATES) whose centre lies inside the half-disc (out to BAT_REACH) is hit once, the moment the bat's sweep passes it.
// Ball / decoy hit: speed = (BAT_V + BAT_KEEP x the speed it had) x (1 + BAT_CHARGE_BONUS x charge), capped at BAT_VMAX (+ BAT_VMAX_CHARGE x charge), sent along the aim
// (BAT_AIM_W: 1 = exactly the direction held, 0 = straight away from the batter), plus BAT_CARRY x the batter's velocity. Big hits raise the ball's speed cap like a hatchet hit.
// Player hit: the same with BAT_PLAYER_V / BAT_PLAYER_KEEP / BAT_PLAYER_VMAX.
const BAT_T = 0.2, BAT_COOLDOWN = 4, BAT_REACH = PL * 2, BAT_ARC = Math.PI, BAT_HIT_MARGIN = 0.08; // swing time (s), cooldown (s), bat tip distance from the player's centre, total swept arc (rad, PI = semicircle), extra angular forgiveness on each sweep step (rad)
const BAT_WIND = 0.35, BAT_CHARGE_T = 1, BAT_CHARGE_BONUS = 0.5; // extra pull-back at full charge (rad, drawn only: the hit arc stays BAT_ARC), time to full charge (s), power added at full charge (0.5 = +50%)
const BAT_V = 700, BAT_KEEP = 1.15, BAT_CARRY = 0.6, BAT_VMAX = 1500, BAT_VMAX_CHARGE = 300, BAT_AIM_W = 1, BAT_FX = 0.3; // ball: flat speed added, share of its own speed kept, share of the batter's velocity added, speed cap (+ extra at full charge), aim vs away blend (1 = pure aim direction), streak length (s)
const IMPACT_V0 = 260, IMPACT_V1 = 1000;
const BAT_PLAYER_V = 550, BAT_PLAYER_KEEP = 0.5, BAT_PLAYER_VMAX = 1100, BAT_HITS_TEAMMATES = true;

// Barbwire: hold the special key to make your grapple rope (the hook in flight, then the tether) lethal: any other player whose body touches it dies (teammates too if
// BARBWIRE_HITS_TEAMMATES). It only does anything while a rope is out, but the clock runs the whole time the key is held. Letting go (or BARBWIRE_MAX_T s, whichever comes first)
// starts the cooldown, which is proportional to how long it was held: BARBWIRE_CD_RATIO x the hold time (a quick tap costs almost nothing, a full hold costs BARBWIRE_MAX_T x ratio).
const BARBWIRE_MAX_T = 4, BARBWIRE_CD_RATIO = 2, BARBWIRE_HALF_W = 2, BARBWIRE_HITS_TEAMMATES = true; // longest hold (s), cooldown seconds per second held, half the rope's lethal thickness (u)

// Warp: press the special key to drop a marker where you stand (placing is free and instant, and a marker stays until it is used or the round ends). A dashed line is drawn from you to
// it. Press again to teleport to the marker: position only, so velocity (all your momentum) is kept. Your grapple stays attached (the rope's normal leash rules apply from the new spot). The cooldown (WARP_COOLDOWN s) starts at the teleport; a second press while it runs does nothing, and the marker waits. WARP_FX = how long the arrival / departure rings last.
const WARP_COOLDOWN = 12, WARP_FX = 0.4;

// Awakened: press the special key to power up for AWAKENED_T s; when it wears off the cooldown (AWAKENED_COOLDOWN s) starts. While awake: the grapple meter does not drain, you cannot
// be overcharged (a lockout already running is cleared as you awaken), the Death Ball cannot kill you (it bounces you off instead) and your crashes hit AWAKENED_CRASH times as hard:
// the push you give a ball, a decoy or another player is multiplied (see crashPush in collision.js). Pressing again while awake does nothing.
const AWAKENED_CRASH = 3, AWAKENED_T = 10, AWAKENED_COOLDOWN = 15;

// Explode: press the special key to blast everything whose centre is within EXPLODE_R + its own radius of you: every other living player (teammates too), the Death Ball and every
// decoy. The kick is ADDITIVE (it is added to the body's velocity, nothing is cancelled) and it gets stronger the closer the body is to you:
//   kick = EXPLODE_KICK_MIN (right at the edge) .. EXPLODE_KICK_MAX (dead centre), shaped by EXPLODE_FALLOFF (1 = linear, >1 = the strength stays low until it is really close).
// Amplify: a body that is already moving is pushed along its OWN motion, not just straight away from you, so exploding while you swing the ball makes the shot faster.
//   EXPLODE_AMP_BLEND = how far the push direction follows the body's motion (0 = always radial, 1 = fully along its motion), reached at EXPLODE_AMP_SPEED u/s;
//   EXPLODE_AMP_GAIN  = extra speed added on top, as a share of the body's current speed (0.5 = a ball doing 800 u/s gets +400 u/s more).
//   Only the part of its motion that is NOT toward you counts (a body flying into you is pushed out sideways / away, never deeper in).
// If anyone dies within EXPLODE_WINDOW s of the blast, Explode's cooldown drops to zero at once. Every new round resets all cooldowns, so a refund earned by the death that ENDS the
// round (always the case in 1v1) would be lost: with EXPLODE_CARRY on, you start the next round with Explode ready.
// EXPLODE_FX = how long the blast is drawn (crisp zone circle, shock rings, motion lines).
const EXPLODE_R = 3 * PL, EXPLODE_COOLDOWN = 10, EXPLODE_WINDOW = 5, EXPLODE_CARRY = true, EXPLODE_FX = 0.65;
const EXPLODE_KICK_MIN = 600, EXPLODE_KICK_MAX = 1800, EXPLODE_FALLOFF = 1.2;
const EXPLODE_AMP_BLEND = 0.5, EXPLODE_AMP_SPEED = 900, EXPLODE_AMP_GAIN = 0.5;

const ABILITY = { dash: { cast: DASH_CAST, cd: DASH_COOLDOWN }, plinko: { cast: PLINKO_CAST, cd: PLINKO_COOLDOWN }, marionette: { cd: MARIONETTE_COOLDOWN }, decoy: { cast: DECOY_CAST, cd: DECOY_COOLDOWN }, arrow: { cd: ARROW_COOLDOWN }, bat: { cd: BAT_COOLDOWN }, barbwire: { cd: BARBWIRE_MAX_T * BARBWIRE_CD_RATIO }, warp: { cd: WARP_COOLDOWN }, awakened: { cd: AWAKENED_COOLDOWN }, explode: { cd: EXPLODE_COOLDOWN } }; // (cd here is the largest possible cooldown: the HUD tint is shown as a share of it)
const START_CD = 1; // share of each ability's full cooldown still running at the start of a round (0 = ready at once, 1 = full cooldown)

// Crash shot: a player who touches the death ball dies, but first collides with it like two pool balls: an elastic collision along the line between their centers,
// momentum conserved with the player's mass PLAYER_M against the ball's BALL_M. CRASH_E is the restitution (1 = perfectly elastic, no energy lost).
const PLAYER_M = 1, CRASH_E = 0.75;
const PLAYER_BOUNCE = 0.9; // restitution when two players collide: 1 = attacker stops dead and the victim takes all the speed, 0 = they stick together and share it (was 0.4)

// Ground friction (per second, as a share of speed lost): GROUND_BRAKE slows a player on the floor who is not steering (not applied while tethered); BALL_ROLL_DRAG slows the ball rolling on the floor.
// Original values were 5 and 0.4; lower = more slippery.
const GROUND_BRAKE = 2, BALL_ROLL_DRAG = 0.15;
const BALL_R = 14, BALL_I = 3 * BALL_M * BALL_R * BALL_R, BALL_W_MAX = 60; // spin inertia (was 6x: lower = spins up easier) and top spin speed (rad/s, was a hardcoded 45)
