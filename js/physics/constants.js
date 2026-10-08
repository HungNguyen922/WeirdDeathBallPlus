// PHYSICS - constants: arena size and every tuning number for players, ball, ropes and abilities.
// Units are 'u' (1 player length PL = 32 u). Nothing in here knows about drawing.
const W = 950, H = 600, NETX = W / 2;
const PL = 32; // one "player length" (diameter)
const RANGE = 4 * PL; // grapple reach
const RUN = 2 * PL, RISE = 0.75 * PL, PK = 5, NOTCH = 2; // slopes: 2 player lengths long, three quarters of a player tall; PK = half-gap between the middle peaks
const GOAL_Y1 = H - RISE, GOAL_Y0 = GOAL_Y1 - 6 * PL; // goal opening sits just above the goal ramps and is 6 player lengths tall; the jut above it reaches down to GOAL_Y0
// Calibrated against the reference video (tracked at 30 fps; sprite ~25 px = 1 PL = 32 u, so 1 video px = 1.28 u).
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
const LIFT_V = 280, WEIGHT_M = 1.4, WEIGHT_KICK = 350, MIN_LEN = 16; // grapple-jump lift, weight multiplier (lift), min surface tether; WEIGHT_KICK = impulse (u/s) away from the pivot each time weight is pressed while grappling
// Grapple-jump ramp. Chain: each grapple jump within GJ_CHAIN_T s of the last extends a chain; the kick is LIFT_V x min(GJ_MAX, GJ_START * GJ_GROWTH^n), n = jumps already in
// the chain, so spamming ramps it up exponentially. Ease: each kick is delivered over LIFT_RAMP s (smoothstep) instead of in one tick.
const GJ_START = 0.4, GJ_GROWTH = 1.1, GJ_MAX = 1, GJ_CHAIN_T = 1.5, LIFT_RAMP = 0.005;
const LIFT_SLACK = 0.15, LIFT_SLACK_W = 0.07; // extra tether length per unit of grapple-jump lift (normal / weighted)
const GRAPPLE_BURST_T = 0.7; // length (s) of the purple ripple when the grapple meter is overcharged
const GRAPPLE_MAX = 4, GRAPPLE_COOLDOWN = 6, GRAPPLE_REGEN = 1; // grapple meter: seconds of use before it is spent, the lockout (s) once it is, and refill speed (charge-seconds per second) while not gripping
const GROUND_DELAY = 0.1, HOOK_DELAY = 0.1; // the hook lands ~3 frames after the press, on the ground too (measured)
const HEAVY_KS = 1.0, STRETCH_X0 = 120, HOP_AIM = 0.5; // weight = a firmer rope; the rope stiffens as it stretches (x0 = stretch that doubles it); HOP_AIM = horizontal share of the grapple-jump kick // airborne surface grapples take ~3 video frames to land (measured), then kick away from the pivot
const PEG_R = 8, PEG_MAX = 2; // plinko peg: half a player's size (r 8 vs 16), bounce strength = the hatchet's (PAD_*), cooldown (s), pegs per player (placing a new one removes the oldest)
// Ability timing: cast = seconds from pressing the key until the effect happens; cd = cooldown (s) that starts when the effect happens, on top of each
// ability's own reset rule (dash: once per trip off the floor). PEG_LIFE = seconds a peg lasts before it fizzles out.
const DASH_CAST = 0.12, DASH_COOLDOWN = 5, PLINKO_CAST = DASH_CAST, PLINKO_COOLDOWN = 5, PEG_LIFE = 10;
// Marionette: hold the special key to aim (the arrow(s) are read live while it is held), release to shove the death ball that way. Releasing with no direction cancels it and spends
// nothing; letting go of the arrows up to MARIONETTE_GRACE s before the key still counts (so releasing both together does not lose your aim). A tap with an arrow held fires at
// once. The shove cancels the ball's motion against it first, like dash does. The cooldown starts when it fires.
// Decoy: a 1 s cast. At the end a lookalike ball appears where you stood when you pressed. It has the death ball's physics and can be grappled, thrown and scored with, but it
// never kills. Unlike the death ball it is also a solid body: it collides with players, the death ball and other decoys (DECOY_BOUNCE_*: 0 = dead stop, 1 = perfectly bouncy; the
// ball is light, BALL_M against a player's 1, so players knock it around). One per player: casting again (once DECOY_COOLDOWN has run out) removes the old one and puts a new
// one at the new spot. The cooldown starts when the decoy appears.
const MARIONETTE_GRACE = 0.1, MARIONETTE_COOLDOWN = 20, MARIONETTE_V = 500, MARIONETTE_FX = 0.3; // shove speed (u/s) added to the ball, length (s) of its streak effect
const DECOY_CAST = 1, DECOY_COOLDOWN = 30, DECOY_BOUNCE_PLAYER = 0.5, DECOY_BOUNCE_BALL = 0.8, DECOY_TELL = true; // DECOY_TELL: draw a dashed ring in the caster's color around the decoy (false = a perfect lookalike)
// Arrow: hold the special key to charge (ARROW_CHARGE_T s to full), release to fire along the aim. LEFT / RIGHT turn it at ARROW_TURN rad/s; a double tap within ARROW_DBL_T s snaps it.
// The death ball / decoys gain ARROW_BALL_K x the arrow's velocity; an enemy is knocked back by ARROW_KNOCK x it (ARROW_KILLS = true kills instead).
const ARROW_CHARGE_T = 1.2, ARROW_V_MIN = 300, ARROW_V_MAX = 1200, ARROW_G = G, ARROW_TURN = 2.2, ARROW_DBL_T = 0.25, ARROW_COOLDOWN = 2;
const ARROW_R = 3, ARROW_BALL_K = 0.6, ARROW_KNOCK = 0.75, ARROW_KILLS = false, ARROW_LIFE = 10, ARROW_STICK_T = 5;
const ARROW_LEN = 22, ARROW_HALF_W = 2.5, ARROW_SPENT_K = 0.15; // drawn length, half the drawn width (= collision thickness), share of speed a spent arrow keeps
// Bat: press the special key to swing it toward the arrow(s) held (none held = toward the death ball). The bat is only drawn, it is not a body: during the swing (BAT_T s) the
// death ball and decoys inside a sector in front of the player (BAT_HIT_HALF rad either side of the bat's current angle, out to BAT_REACH) are hit once each. A hit launches the
// object at BAT_V + BAT_KEEP x the speed it had (so a still ball still flies, a fast one flies faster), mostly along the swing (BAT_AIM_W: 1 = exactly the aimed direction,
// 0 = straight away from the batter), plus BAT_CARRY x the batter's own velocity, capped at BAT_VMAX. Big hits raise the ball's speed cap briefly, like a hatchet hit.
const BAT_T = 0.22, BAT_COOLDOWN = 1.5, BAT_ARC = 2.2, BAT_REACH = 58, BAT_HIT_HALF = 0.55; // swing time (s), cooldown (s), swept angle (rad), bat tip distance from the player's centre, half-width of the hit sector (rad)
const BAT_V = 520, BAT_KEEP = 1, BAT_CARRY = 0.6, BAT_VMAX = 1300, BAT_AIM_W = 0.6, BAT_FX = 0.3; // flat speed added, share of the object's own speed kept, share of the batter's velocity added, hit speed cap, aim vs away blend, streak length (s)
const ABILITY = { dash: { cast: DASH_CAST, cd: DASH_COOLDOWN }, plinko: { cast: PLINKO_CAST, cd: PLINKO_COOLDOWN }, marionette: { cd: MARIONETTE_COOLDOWN }, decoy: { cast: DECOY_CAST, cd: DECOY_COOLDOWN }, arrow: { cd: ARROW_COOLDOWN }, bat: { cd: BAT_COOLDOWN } };
// Crash shot: a player who touches the death ball dies, but first collides with it like two pool balls: an elastic collision along the line between their centers,
// momentum conserved with the player's mass PLAYER_M against the ball's BALL_M. CRASH_E is the restitution (1 = perfectly elastic, no energy lost).
const PLAYER_M = 1, CRASH_E = 1;
const PLAYER_BOUNCE = 0.9; // restitution when two players collide: 1 = attacker stops dead and the victim takes all the speed, 0 = they stick together and share it (was 0.4)
// Ground friction (per second, as a share of speed lost): GROUND_BRAKE slows a player on the floor who is not steering (not applied while tethered); BALL_ROLL_DRAG slows the ball rolling on the floor.
// Original values were 5 and 0.4; lower = more slippery.
const GROUND_BRAKE = 2, BALL_ROLL_DRAG = 0.15;
const BALL_R = 14, BALL_I = 6 * BALL_M * BALL_R * BALL_R; // spin inertia: high, so spin takes a whippy throw

// Floor slopes: a ramp up to each goal and a middle peak made of two overlapping triangles (a notch the ball starts in).