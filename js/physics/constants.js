// PHYSICS - constants: arena size and every tuning number for players, ball, ropes and abilities. Nothing in here knows about drawing.
//
// HOW THIS FILE IS ORGANISED (search for the number in the left column to jump to a section)
//    1  ARENA & UNITS          the size of the world, the slopes, the goals
//    2  MOVEMENT & GRAVITY     the physics step, gravity, jumping, running, ground friction
//    3  GRAPPLE: THE HOOK      reach, how fast the hook lands, the grapple meter
//    4  GRAPPLE JUMP           the pull that launches you off a platform (chain, reach, strength)
//    5  GRAPPLE FLOAT & ROPE   the rope's spring, and the float that holds you above the pivot
//    6  WEIGHT KICK            pressing WEIGHT while grappling: the bob
//    7  PIVOT SLAM             coming back down onto a floor pivot
//    8  DEATH BALL & TETHER    ball physics, and the rope when you grapple the ball
//    9  COLLISIONS             player vs ball, player vs player, impact sparks
//   10  SPECIAL ABILITIES      shared rules, then Dash, Plinko, Marionette, Decoy, Arrow, Bat, Barbwire, Warp, Awakened, Explode
//   11  MATCH                  which team is on which side
// Units: u = one world unit. PL = 32 u = one player length (a player's diameter). s = seconds. The sim runs 120 ticks per second.
// Order matters a little: a constant can only use constants defined ABOVE it (PL, H, G ... are all in section 1-2).

// =====================================================================================================================================================================
// 1  ARENA & UNITS
// =====================================================================================================================================================================
const W = 950, H = 600, NETX = W / 2; // arena width and height (u); NETX = x of the net, in the middle. Everything else in the game is measured from these
const PL = 32;                        // one "player length" (a player's diameter). Most distances below are written as multiples of it. Changing it rescales the slopes and goals, NOT the players (their radius is 16 in player.js)

// Slopes: the floor rises on both sides of the net.
const RUN = 2 * PL;                   // how long each slope is (horizontal). Longer = gentler ramps
const RISE = 0.75 * PL;               // how tall each slope is. Taller = steeper ramps
const PK = 5;                         // half the gap between the two middle peaks, either side of the net (u)
const NOTCH = 2;                      // how far the floor dips between the two middle peaks (u)

// Goals: an opening in each side wall.
const GOAL_Y1 = H - RISE;             // bottom of the goal opening: just above the goal ramps
const GOAL_Y0 = GOAL_Y1 - 6 * PL;     // top of the goal opening: the opening is 6 player lengths tall, and the jut above it reaches down to here

// =====================================================================================================================================================================
// 2  MOVEMENT & GRAVITY
// =====================================================================================================================================================================
const DT = 1 / 120;                   // physics timestep (s). Fixed at 120 Hz. Changing it changes how every speed, force and timer FEELS, so retune if you touch it
const G = 410;                        // gravity (u/s^2) in free fall. Raise = heavier, faster falls; lower = floatier
const G_FLOAT = 90;                   // gravity while UP is held in the air (long, symmetric, floaty arcs). Also applies on a rope, so holding UP makes grapple jumps go much higher
const DOWN_G = 2.2;                   // gravity multiplier while DOWN is held (fast-fall / drop). Also cancels the UP float. A way to build momentum on purpose when grappling
const JUMP_V = 150;                   // launch speed (u/s) of a plain jump off the ground: ~88 u apex, ~2 s airtime with G_FLOAT
const RUN_ACC = 185;                  // running acceleration (u/s^2) on the ground (it is 0.55x of this in the air): about 0 -> 270 u/s in ~1.5 s
const GROUND_BRAKE = 2;               // ground friction (per second, share of speed lost) for a player on the floor who is not steering. Not applied while tethered. Lower = more slippery (the original was 5)

// =====================================================================================================================================================================
// 3  GRAPPLE: THE HOOK  (press and hold GRAPPLE: the nearest thing in range is picked, the hook lands, a rope is out)
// =====================================================================================================================================================================
const RANGE = 4 * PL;                 // how far from you a hook can latch (128 u). Also the hard cap on a grapple jump's reach from the pivot
const MIN_LEN = 16;                   // the shortest a surface rope can be (u). Standing on the floor you are 16 u (your radius) from the floor pivot, so this is also your starting distance
const GROUND_DELAY = 0.05;             // seconds between the press and a surface hook landing, when you are standing (the original game measured ~3 frames). Lower = snappier start, 0 = same tick
const HOOK_DELAY = 0.05;               // the same, when you are in the air. (Ball hooks land instantly, whatever these say)
const HOOK_R = 3;                     // radius (u) of the hook dot as DRAWN (display only; does not collide with anything)

// The grapple meter: holding a rope (or a hook in flight) drains it; letting go refills it.
const GRAPPLE_MAX = 4;                // seconds of grip in a full meter. Spend it all and you are overcharged: the rope is torn away
const GRAPPLE_COOLDOWN = 6;           // seconds of lockout (no grappling at all) after an overcharge. The meter then restarts from 0, not from full
const GRAPPLE_REGEN = 1;              // refill speed (charge-seconds per second) while NOT gripping. 1 = it refills as fast as it drains
const GRAPPLE_BURST_T = 0.7;          // how long (s) the purple ripple lasts when you are overcharged (display only)

// =====================================================================================================================================================================
// 4  GRAPPLE JUMP - every number that shapes it, in the order it happens.
//
// WHAT HAPPENS, STEP BY STEP
//   1. You press and hold grapple. The hook lands after GROUND_DELAY / HOOK_DELAY (section 3).
//   2. When the hook lands on a FLOOR or SLOPE pivot while you are standing or rising (vy <= 0), a grapple jump starts. (Ledges, walls, ceiling, net and the ball never do.)
//   3. The rope's length is set to the REACH: how far from the pivot you will be pulled to (GJ_REACH_GROUND, capped at RANGE).
//   4. For GJ_DRIVE_T seconds the rope accelerates you away from the pivot. The pull is strongest at the start and fades out over the last GJ_EASE u before the reach.
//   5. After the window you coast on the speed you built; the rope goes taut at its length and the grapple float (section 5) holds you there.
//   Letting go of grapple at any point stops the pull on the spot (you keep whatever speed you have).
//
// HOW HIGH YOU GO depends on (a) the chain (how hard the pull is), (b) how much of the window you get (the pull stops once you are at the reach), and (c) the speed you already
// had when the hook landed (a regrab while rising adds to it, up to this jump's top speed).
// =====================================================================================================================================================================

// --- Reach: how far the rope pulls you out ------------------------------------------------------------------------------------------------------------------------
const GJ_REACH_GROUND = PL * 1.25;    // 40 u: how much FURTHER from the pivot than you are right now the rope reaches. Standing on the floor: rope = 16 + 40 = 56 u.
                                      //   The float sags a few u under the rope's length, so you settle with your feet about 1 PL off the platform. Raise = every jump goes higher
const GJ_REACH_WEIGHTED = 0.5;        // share of the reach you get when WEIGHT is held as the hook lands (0.5 = half as far: weight is a short, heavy hop)
const GJ_EASE = PL / 2;               // 16 u: the pull fades out over the last GJ_EASE u before the reach, so you glide in instead of slamming into the rope.
                                      //   Bigger = softer, floatier arrival but you stall a little short of the reach / 0 = full pull right up to the rope (overshoot + bounce)

// --- Strength: how hard the pull is -------------------------------------------------------------------------------------------------------------------------------
const LIFT_V = 280;                   // u/s: the base speed of a grapple jump at full chain. The pull's top speed = LIFT_V x chain x (WEIGHT_M if weighted) x GJ_DRIVE_BOOST x air scale
const GJ_DRIVE_BOOST = 2.2;           // multiplier on that top speed (it exists so the pull can cover the reach inside the short window). First jump from the floor: 280 x 0.4 x 2.2 = ~246 u/s,
                                      //   a full chain: 616 u/s. The acceleration is top speed / GJ_DRIVE_T, so this scales the snap and the height together.
                                      //   THIS (and GJ_REACH_GROUND) is the "pop" you feel when a float is established: the pull overshoots the float point by ~16 u on a floor jump, then the rope reels you back
const WEIGHT_M = 1.2;                 // multiplier on the pull while WEIGHT is held as the hook lands (stronger, but see GJ_REACH_WEIGHTED: it reaches less far)
const GJ_DRIVE_T = 0.2;              // s: the window the pull runs for after the hook lands. Short on purpose: shorter = snappier and more all-or-nothing, longer = smoother and
                                      //   more forgiving (you can reach full speed from a later press). Pull strength = top speed / this, so lengthening it also softens each tick

// --- Latching while already high: weaker than a jump off the platform ---------------------------------------------------------------------------------------------
// When the hook lands far from its pivot (you are already up in the air, e.g. re-grabbing mid-bob), both the reach and the pull speed are scaled down:
// full strength when you are within GJ_NEAR u of the pivot, fading in a straight line to GJ_AIR_SCALE x strength by GJ_FAR u. A jump off the platform is always full strength.
const GJ_AIR_SCALE = 1;             // strength left when latching GJ_FAR u or more above the pivot (1 = no weakening, 0.5 = half the reach and half the pull, 0 = no jump at all up there)
const GJ_NEAR = PL;                   // 32 u: within this distance of the pivot you get the full jump. (Jumping with UP held lifts you a little before the hook lands: keep this above that)
const GJ_FAR = 3 * PL;                // 96 u: from this distance up you get the weakest jump (GJ_AIR_SCALE)

// --- Chain: spamming grapple jumps ramps the strength up ----------------------------------------------------------------------------------------------------------
// chain factor = min(GJ_MAX, GJ_START x GJ_GROWTH ^ n), n = grapple jumps already in the chain. Then it multiplies LIFT_V above.
const GJ_START = 1;                 // chain factor of the first jump (40% of full strength)
const GJ_GROWTH = 1.5;                // each further jump in the chain is 10% stronger than the one before (0.4, 0.44, 0.48, 0.53 ...)
const GJ_MAX = 1;                     // ceiling on the chain factor; with the numbers above it is reached on the 11th jump (0.4 x 1.1^10 = 1.04)
const GJ_CHAIN_T = 5;               // s: if this long passes since the last grapple jump landed, the chain resets to jump 1

// --- Direction ----------------------------------------------------------------------------------------------------------------------------------------------------
const HOP_AIM = 0.5;                  // sideways share of the pull's direction. The pull points away from the pivot; the horizontal part is scaled by this, then it is renormalised.
                                      //   Pivot straight below: no effect (straight up). Pivot below-and-behind (slopes, standing off to the side): 1 = full diagonal, 0 = always straight up

// =====================================================================================================================================================================
// 5  GRAPPLE FLOAT & ROPE
// A surface rope is a LEASH: a maximum length, nothing more. Stretched past it, it acts as a spring that pulls you back; shorter than it, it is slack. On top of that, a
// "float" holds you above a floor pivot at the rope's length: below that point a second spring pushes you back up. The two together make the bob.
// =====================================================================================================================================================================

// --- The rope spring (past the rope's length) ---------------------------------------------------------------------------------------------------------------------
const KS = 80;                        // stiffness (force per u of stretch). Higher = snaps back harder and stops you sooner, so kicks and jumps overshoot less / lower = long, stretchy swings
const DAMP = 0.8;                     // damping while the rope is being STRETCHED (the way back is undamped on purpose, so the pull-back keeps its energy). Higher = overshoot dies out faster
const STRETCH_X0 = 400;               // the rope stiffens as it stretches: its force is multiplied by (1 + stretch / this). Smaller = stiffens sooner = a harder wall past the rope's length
const HEAVY_KS = 1.0;                 // multiplier on the rope's AND the float's stiffness while WEIGHT is held (1 = weight changes nothing, 1.5 = a firmer rope while weighted)
const RETURN_DAMP = 6;                // brakes the pull-back while you are heading toward the pivot (surface ropes only). Higher = softer, slower rubberband

// --- The float (below the rope's length: holds you above the pivot) -----------------------------------------------------------------------------------------------
const TAUT_K = 110;                   // float stiffness: how hard it pushes you back up when you sink below the float point. Higher = a stiffer, higher-frequency bob
const TAUT_DAMP = 18;                 // braking on the way DOWN through the float zone. THE UNDERSHOOT KNOB: 12 = sink ~1 PL and bob a few times, 18 = sink ~0.7 PL and bob about once,
                                      //   30+ = barely sink. Remember the float point of a floor jump is only ~1 PL off the floor, so a big undershoot reaches the floor
const TAUT_MIN_NY = 0.9;    // float starts at ~26° off vertical (was 0.5 = 60°)
const TAUT_FADE = 0.08;     // fully on by ny = 0.98 (~11° off vertical)

const TAUT_CENTER = 6;                // while floating in the air, how hard you are pulled back over the pivot sideways. Higher = you hang straight above it
const TAUT_DRAG = 3;                  // while floating in the air, sideways speed lost per second. Higher = sideways speed dies faster

// --- The bob zone: a little sag is allowed just under the float point --------------------------------------------------------------------------------------------
const BOB_DEPTH = PL/ 4;              // u below the float point where the float spring is only BOB_SOFT x as stiff (a gentle landing for the sag)
const BOB_KICK_BONUS = 6;             // extra u of bob zone right after a weight kick (fades over DRIB_T s), so a kick can sink you a little before the float catches you
const BOB_SOFT = 0.25;                // spring strength inside the bob zone (0.25 = a quarter as stiff). Lower = a softer, deeper sag

// --- The post-kick window (what a weight kick does to the float) --------------------------------------------------------------------------------------------------
const DRIB_T = 0.45;                  // s: how long the post-kick window lasts (the bob zone is wider, and DRIB_FLOAT_FADE applies)
const DRIB_FLOAT_FADE = 1;            // a below-float press now fully switches the float off, so you fall to the pivot
const DRIB_BELOW_TOL = PL;            // u under the float point where a press still kicks you upward

const FLOAT_RELEASE_DEPTH = 22;       // u under the float point where the float lets go (dribble)
const FLOAT_OFF_RATE = 25;            // how fast (per second) the float fades OUT when DRIB_FLOAT_FADE asks for it (only matters if you raise DRIB_FLOAT_FADE)
const FLOAT_ON_RATE = 3;              // how fast (per second) the float fades back IN afterwards. Lower = a longer, floppier recovery

// =====================================================================================================================================================================
// 6  WEIGHT KICK (press WEIGHT while grappling): the bob
// Every press tries to throw you away from the pivot, about WEIGHT_KICK_REACH u past the float point. The rope then pulls you back like a rubber band: the further past the
// float point, the harder. You swing back, can sink a little under the float point on the momentum, and keep bobbing (damped by TAUT_DAMP) until you settle there.
// A press tops you up to the kick's speed rather than adding on top of what you have, and it fades out the further you already are, so spamming cannot snowball:
//   outward speed after a press = WEIGHT_KICK x (1 - how far past the float point you are / WEIGHT_KICK_REACH), if you were slower than that.
// =====================================================================================================================================================================
const WEIGHT_KICK = 600;              // u/s of outward speed a press tries to reach, from the float point. THE main knob for how hard a kick throws you:
                                      //   300 = ~1 PL out | 600 = ~1.6 PL | 800 = ~2 PL (default) | 1000+ = hard enough to slam you right down to the pivot on the way back
const WEIGHT_KICK_REACH = 5 * PL;     // u past the float point where a press stops adding anything (the cap on how far a second kick can throw you). Raise = allows bigger stacked bobs
const PRIME_T = 0.4;                  // s a WEIGHT press stays "primed" after you let go: a grapple that lands inside this window gets its kick at once (WEIGHT held = always primed)
// Things elsewhere that shape the bob: KS (rubber band above), TAUT_DAMP / TAUT_K / BOB_* (below the float point), G and HEAVY_KS (gravity is x1.35 while WEIGHT is held), DOWN (fast-fall).

const KICK_STEEP = 1;   // up / down held: the vertical share of the kick is multiplied by this (higher = steeper)
const KICK_FLAT = 0.35;   // left / right held: the vertical share is multiplied by this (lower = flatter)
const KICK_STEER = 1;   // left / right held: extra sideways push toward the held direction
// =====================================================================================================================================================================
// 7  PIVOT SLAM
// When you come back down onto the floor right at a floor/slope pivot (within PIVOT_ZONE of it), the speed the floor would absorb is turned into sideways speed along the
// surface instead (a rotation, so your speed is kept) and sends you out the other side. This is what a hard fall onto the pivot does.
// =====================================================================================================================================================================
const PIVOT_ZONE = 3 * PL;            // how close to the pivot (u) you must land for the slam to turn into sideways speed. Bigger = it works from further away
const PIVOT_MIN_HIT = 30;             // the slowest impact (u/s into the floor) that counts as a slam. Raise = gentle landings never trigger it
const PIVOT_TRANSFER = 0.85;          // share of the absorbed speed turned into sideways speed (1 = all of it, 0 = a normal landing)

// =====================================================================================================================================================================
// 8  DEATH BALL & TETHER
// =====================================================================================================================================================================
// --- The ball itself ------------------------------------------------------------------------------------------------------------------------------------------------
const BALL_G = 170;                   // ball gravity (u/s^2). Lower = a floatier ball
const BALL_VMAX = 920;                // ball speed cap (u/s) in normal play (hard hits can raise it for a while)
const BALL_R = 14;                    // ball radius (u)
const BALL_M = 0.25;                  // ball mass against a player's 1: players knock it around easily. Also how the decoys and crash shots weigh it
const BALL_I = 3 * BALL_M * BALL_R * BALL_R; // spin inertia (was 6x that: lower = spins up easier)
const BALL_W_MAX = 60;                // top spin speed (rad/s; it was a hard-coded 45)
const BALL_ROLL_DRAG = 0.15;          // how fast the ball slows rolling on the floor (per second, share of speed lost). The original was 0.4; lower = rolls further

// --- The tether: grappling the ball (or a decoy) ------------------------------------------------------------------------------------------------------------------
// Same elastic rope as on platforms (progressive spring, firmer with weight) but much stiffer, so the stretch stays small and the maximum length is enforced. Inside
// that length the rope is slack and does nothing: the ball and the player can move toward each other freely.
const KB = 150;                       // tether stiffness (the ball's version of KS). Higher = the leash is harder
const DB = 0.6;                       // tether damping while it is being stretched (the ball's version of DAMP)
const BALL_RIGID = 0.6;               // share of the outward speed the rope cancels outright; the spring takes the rest. 1 = a hard rod, 0 = pure spring
const BALL_PULL = 0.1;                // share of the tether's pull the PLAYER feels (1 = the original, 0 = a weightless ball you cannot be dragged by). The ball always feels all of it
const BALL_TM = 0.7;                  // ball mass as the tether sees it (higher = the rope moves the ball less and you more)

// =====================================================================================================================================================================
// 9  COLLISIONS
// =====================================================================================================================================================================
// Crash shot: a player who touches the death ball dies, but first collides with it like two pool balls: an elastic collision along the line between their centers,
// momentum conserved with the player's mass PLAYER_M against the ball's BALL_M. CRASH_E is the restitution (1 = perfectly elastic, no energy lost).
const PLAYER_M = 1;                   // a player's mass in collisions with the ball and decoys
const CRASH_E = 0.75;                 // restitution of a crash into the ball: higher = the ball is hit harder
const PLAYER_BOUNCE = 0.9;            // restitution when two players collide: 1 = attacker stops dead and the victim takes all the speed, 0 = they stick together and share it (was 0.4)
const IMPACT_V0 = 260;                // the slowest impact (u/s) that throws sparks when a player hits something
const IMPACT_V1 = 1000;               // the impact speed (u/s) that gives the biggest spark burst (display only; sparks scale between V0 and V1)

// =====================================================================================================================================================================
// 10  SPECIAL ABILITIES
// =====================================================================================================================================================================
// --- Shared ------------------------------------------------------------------------------------------------------------------------------------------------------
// Ability timing: cast = seconds from pressing the key until the effect happens; cd = cooldown (s) that starts when the effect happens, on top of each
// ability's own reset rule (dash: once per trip off the floor). The ABILITY table itself is at the bottom of this section (it reads every cooldown).
const START_CD = 1;                   // share of each ability's full cooldown still running at the start of a round (0 = ready at once, 1 = full cooldown)

// --- Dash --------------------------------------------------------------------------------------------------------------------------------------------------------
const DASH_V = 420;                   // dash impulse (u/s) in the arrow direction(s) held
const DASH_FX = 0.6;                  // how long (s) the dash streak is drawn (display only)
const DASH_CAST = 0.1;                // s from pressing until the dash happens
const DASH_COOLDOWN = 5;              // s before the next dash (on top of: one dash per trip off the floor)

// --- Plinko ------------------------------------------------------------------------------------------------------------------------------------------------------
const PEG_R = PL / 3;                 // plinko peg radius (u): half a player's size (r 8 vs 16). Bounce strength = the hatchet's (PAD_*)
const PEG_MAX = 2;                    // pegs per player: placing a new one removes the oldest
const PEG_LIFE = 10;                  // seconds a peg lasts before it fizzles out
const PLINKO_CAST = DASH_CAST;        // s from pressing until the peg is placed (same as dash)
const PLINKO_COOLDOWN = 5;            // s before the next peg

// --- Marionette --------------------------------------------------------------------------------------------------------------------------------------------------
// Hold the special key to aim (the arrow(s) are read live while it is held), release to shove the death ball that way. Releasing with no direction cancels it and spends
// nothing; letting go of the arrows up to MARIONETTE_GRACE s before the key still counts (so releasing both together does not lose your aim). A tap with an arrow held fires at
// once. The shove cancels the ball's motion against it first, like dash does. The cooldown starts when it fires.
const MARIONETTE_GRACE = 0.1;         // s: letting go of the arrows this long before the key still counts as aiming
const MARIONETTE_COOLDOWN = 10;       // s before the next shove
const MARIONETTE_V = 500;             // shove speed (u/s) added to the ball
const MARIONETTE_FX = 0.6;            // length (s) of its streak effect (display only)

// --- Decoy -------------------------------------------------------------------------------------------------------------------------------------------------------
// A 1 s cast. At the end a lookalike ball appears where you stood when you pressed. It has the death ball's physics and can be grappled, thrown and scored with, but it
// never kills. Unlike the death ball it is also a solid body: it collides with players, the death ball and other decoys (DECOY_BOUNCE_*: 0 = dead stop, 1 = perfectly bouncy; the
// ball is light, BALL_M against a player's 1, so players knock it around). One per player: casting again (once DECOY_COOLDOWN has run out) removes the old one and puts a new
// one at the new spot. The cooldown starts when the decoy appears.
const DECOY_CAST = 1;                 // s from pressing until the decoy appears
const DECOY_COOLDOWN = 20;            // s before the next decoy
const DECOY_BOUNCE_PLAYER = 0.75;     // bounciness of a decoy against players (0 = dead stop, 1 = perfectly bouncy)
const DECOY_BOUNCE_BALL = 0.8;        // bounciness of a decoy against the death ball and other decoys
const DECOY_TELL = false;             // true = draw a dashed ring in the caster's color around the decoy (false = a perfect lookalike)

// --- Arrow -------------------------------------------------------------------------------------------------------------------------------------------------------
// Hold the special key to charge (ARROW_CHARGE_T s to full), release to fire along the aim. LEFT / RIGHT turn it at ARROW_TURN rad/s; a double tap within ARROW_DBL_T s snaps it.
// The death ball / decoys gain ARROW_BALL_K x the arrow's velocity; an enemy is knocked back by ARROW_KNOCK x it (ARROW_KILLS = true kills instead).
const ARROW_CHARGE_T = 1.2;           // s to charge to full
const ARROW_V_MIN = 300;              // launch speed (u/s) of an uncharged arrow
const ARROW_V_MAX = 1200;             // launch speed (u/s) at full charge
const ARROW_G = G;                    // gravity on a flying arrow (u/s^2). Lower = flatter shots
const ARROW_TURN = 2.2;               // how fast LEFT / RIGHT turn the aim (rad/s)
const ARROW_DBL_T = 0.25;             // s: a double tap within this snaps the aim
const ARROW_COOLDOWN = 2;             // s before the next arrow
const ARROW_R = PL / 4;               // arrow radius for hitting things (u)
const ARROW_BALL_K = 0.6;             // the death ball / decoys gain this share of an arrow's velocity
const ARROW_KNOCK = 0.75;             // an enemy hit is knocked back by this share of the arrow's velocity
const ARROW_KILLS = false;            // true = an arrow kills an enemy outright instead of knocking it back
const ARROW_LIFE = 10;                // s a loose arrow lasts
const ARROW_STICK_T = 5;              // s an arrow stays stuck in a wall (standing on it counts as ground)
const ARROW_LEN = PL;                 // drawn length (u)
const ARROW_HALF_W = PL / 6;          // half the drawn width (u) = its collision thickness
const ARROW_SPENT_K = 0.15;           // share of its speed a spent arrow keeps
// Arrows as bodies: loose arrows can be pushed by an Explode blast, swatted by a bat and bumped by players (see arrowKnock / arrowBumpPlayers in physics/arrows.js).
const ARROW_DEFLECT_TEAM = true;      // a batted arrow becomes the batter's team's arrow (it can now hit the player who fired it)
const ARROW_REARM = true;             // a spent arrow that is knocked by a bat or a blast can hit an enemy again
const ARROW_IMMUNE_T = 0.3;           // s a knocked arrow cannot be hit by another bat / blast (stops a swing hitting it on several ticks)
const ARROW_GHOST_T = 0.05;           // s a dislodged arrow ignores terrain, so it can leave the wall it was stuck in
const ARROW_KNOCK_LIFE = 4;           // a knocked arrow lives at least this long (s)
const ARROW_VCAP = 1800;              // top speed of an arrow after any impulse (u/s)
const ARROW_BUMP_E = 0.6;             // player bump: restitution
const ARROW_BUMP_GRACE = 0.2;         // the shooter cannot bump their own arrow for this long after firing (s)
const BAT_ARROW_V = 500;              // bat vs arrow: flat speed added (u/s)
const BAT_ARROW_KEEP = 1;             // bat vs arrow: share of the arrow's own speed kept
const BAT_ARROW_VMAX = 1600;          // bat vs arrow: speed cap (+ BAT_VMAX_CHARGE at full charge)
const BAT_HITS_STUCK_ARROWS = true;   // the bat can dislodge arrows that are stuck in a wall

// --- Bat ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Hold the special key to charge (BAT_CHARGE_T s to full; a tap is a weak swing), release to swing. The swing is a SEMICIRCLE (BAT_ARC rad) centred on the direction held
// (read live while charging, the last one held counts; none ever held = toward the death ball), so it can be tilted anywhere round the player. The bat starts at one end of the
// arc, sweeps through the aim and finishes at the other end (BAT_T s in all). It is only drawn, it is not a body. Every target (death ball, decoys, other players, teammates too if
// BAT_HITS_TEAMMATES) whose centre lies inside the half-disc (out to BAT_REACH) is hit once, the moment the bat's sweep passes it.
// Ball / decoy hit: speed = (BAT_V + BAT_KEEP x the speed it had) x (1 + BAT_CHARGE_BONUS x charge), capped at BAT_VMAX (+ BAT_VMAX_CHARGE x charge), sent along the aim
// (BAT_AIM_W: 1 = exactly the direction held, 0 = straight away from the batter), plus BAT_CARRY x the batter's velocity. Big hits raise the ball's speed cap like a hatchet hit.
// Player hit: the same with BAT_PLAYER_V / BAT_PLAYER_KEEP / BAT_PLAYER_VMAX.
const BAT_T = 0.2;                    // s the swing takes
const BAT_COOLDOWN = 4;               // s before the next swing (starts when the swing ends)
const BAT_REACH = PL * 2;             // bat tip distance from the player's centre (u)
const BAT_ARC = Math.PI;              // total swept arc (rad; PI = semicircle)
const BAT_HIT_MARGIN = 0.08;          // extra angular forgiveness on each sweep step (rad)
const BAT_WIND = 0.35;                // extra pull-back at full charge (rad, drawn only: the hit arc stays BAT_ARC)
const BAT_CHARGE_T = 2;               // s to full charge
const BAT_CHARGE_BONUS = 1;           // power added at full charge (0.5 = +50%, 1 = double)
const BAT_V = 700;                    // ball: flat speed added (u/s)
const BAT_KEEP = 1.15;                // ball: share of its own speed kept (above 1 = the swing speeds a moving ball up)
const BAT_CARRY = 0.6;                // ball: share of the batter's own velocity added
const BAT_VMAX = 1500;                // ball: speed cap (u/s)
const BAT_VMAX_CHARGE = 300;          // ball: extra cap at full charge
const BAT_AIM_W = 1;                  // ball: aim vs away blend (1 = exactly the direction held, 0 = straight away from the batter)
const BAT_FX = 0.6;                   // streak length (s) drawn after a hit (display only)
const BAT_PLAYER_V = 500;             // player hit: flat speed added (u/s)
const BAT_PLAYER_KEEP = 0.5;          // player hit: share of the player's own speed kept
const BAT_PLAYER_VMAX = 1800;         // player hit: speed cap (u/s)
const BAT_HITS_TEAMMATES = true;      // the bat hits your teammate too

// --- Barbwire ----------------------------------------------------------------------------------------------------------------------------------------------------
// Hold the special key to make your grapple rope (the hook in flight, then the tether) lethal: any other player whose body touches it dies (teammates too if
// BARBWIRE_HITS_TEAMMATES). It only does anything while a rope is out, but the clock runs the whole time the key is held. Letting go (or BARBWIRE_MAX_T s, whichever comes first)
// starts the cooldown, which is proportional to how long it was held: BARBWIRE_CD_RATIO x the hold time (a quick tap costs almost nothing, a full hold costs BARBWIRE_MAX_T x ratio).
const BARBWIRE_MAX_T = 4;             // longest hold (s)
const BARBWIRE_CD_RATIO = 2;          // cooldown seconds per second held
const BARBWIRE_HALF_W = 2;            // half the rope's lethal thickness (u)
const BARBWIRE_HITS_TEAMMATES = true; // the wire kills your teammate too

// --- Warp --------------------------------------------------------------------------------------------------------------------------------------------------------
// Press the special key to drop a marker where you stand (placing is free and instant, and a marker stays until it is used or the round ends). A dashed line is drawn from you to
// it. Press again to teleport to the marker: position only, so velocity (all your momentum) is kept. Your grapple stays attached (the rope's normal leash rules apply from the new spot). The cooldown (WARP_COOLDOWN s) starts at the teleport; a second press while it runs does nothing, and the marker waits. WARP_FX = how long the arrival / departure rings last.
const WARP_COOLDOWN = 12;             // s before the next teleport
const WARP_FX = 0.6;                  // how long (s) the arrival / departure rings last (display only)

// --- Awakened ----------------------------------------------------------------------------------------------------------------------------------------------------
// Press the special key to power up for AWAKENED_T s; when it wears off the cooldown (AWAKENED_COOLDOWN s) starts. While awake: the grapple meter does not drain, you cannot
// be overcharged (a lockout already running is cleared as you awaken), the Death Ball cannot kill you (it bounces you off instead) and your crashes hit AWAKENED_CRASH times as hard:
// the push you give a ball, a decoy or another player is multiplied (see crashPush in collision.js). Pressing again while awake does nothing.
const AWAKENED_CRASH = 3;             // multiplier on the push your crashes give while awake
const AWAKENED_T = 10;                // s the power-up lasts
const AWAKENED_COOLDOWN = 15;         // s before the next power-up (starts when it wears off)

// --- Explode -----------------------------------------------------------------------------------------------------------------------------------------------------
// Press the special key to blast everything whose centre is within EXPLODE_R + its own radius of you: every other living player (teammates too), the Death Ball and every
// decoy. The kick is ADDITIVE (it is added to the body's velocity, nothing is cancelled) and it gets stronger the closer the body is to you:
//   kick = EXPLODE_KICK_MIN (right at the edge) .. EXPLODE_KICK_MAX (dead centre), shaped by EXPLODE_FALLOFF (1 = linear, >1 = the strength stays low until it is really close).
// Amplify: a body that is already moving is pushed along its OWN motion, not just straight away from you, so exploding while you swing the ball makes the shot faster.
//   EXPLODE_AMP_BLEND = how far the push direction follows the body's motion (0 = always radial, 1 = fully along its motion), reached at EXPLODE_AMP_SPEED u/s;
//   EXPLODE_AMP_GAIN  = extra speed added on top, as a share of the body's current speed (0.5 = a ball doing 800 u/s gets +400 u/s more).
//   Only the part of its motion that is NOT toward you counts (a body flying into you is pushed out sideways / away, never deeper in).
// If anyone dies within EXPLODE_WINDOW s of the blast, Explode's cooldown drops to zero at once. Every new round resets all cooldowns, so a refund earned by the death that ENDS the
// round (always the case in 1v1) would be lost: with EXPLODE_CARRY on, you start the next round with Explode ready.
// EXPLODE_FX = how long the blast is drawn (crisp zone circle, shock rings, motion lines).
const EXPLODE_R = 3 * PL;             // blast radius (u), measured from your centre to the other body's centre minus its own radius
const EXPLODE_COOLDOWN = 10;          // s before the next blast
const EXPLODE_WINDOW = 5;             // s after a blast in which a death refunds the cooldown
const EXPLODE_CARRY = true;           // a refund earned by the death that ends a round carries into the next round
const EXPLODE_FX = 0.6;               // how long (s) the blast is drawn (display only)
const EXPLODE_KICK_MIN = 400;         // kick (u/s) at the very edge of the blast
const EXPLODE_KICK_MAX = 1600;        // kick (u/s) dead centre
const EXPLODE_FALLOFF = 1.2;          // shape of the kick between edge and centre (1 = linear, higher = stays weak until really close)
const EXPLODE_AMP_BLEND = 0.5;        // how far the push follows the body's own motion (0 = always straight away from you, 1 = fully along its motion)
const EXPLODE_AMP_SPEED = 900;        // body speed (u/s) at which that blend is fully reached
const EXPLODE_AMP_GAIN = 0.5;         // extra speed added on top, as a share of the body's current speed

// --- The ability table: reads every cooldown above, so it has to stay below them ------------------------------------------------------------------------------------
const ABILITY = { dash: { cast: DASH_CAST, cd: DASH_COOLDOWN }, plinko: { cast: PLINKO_CAST, cd: PLINKO_COOLDOWN }, marionette: { cd: MARIONETTE_COOLDOWN }, decoy: { cast: DECOY_CAST, cd: DECOY_COOLDOWN }, arrow: { cd: ARROW_COOLDOWN }, bat: { cd: BAT_COOLDOWN }, barbwire: { cd: BARBWIRE_MAX_T * BARBWIRE_CD_RATIO }, warp: { cd: WARP_COOLDOWN }, awakened: { cd: AWAKENED_COOLDOWN }, explode: { cd: EXPLODE_COOLDOWN } }; // (cd here is the largest possible cooldown: the HUD tint is shown as a share of it)

// =====================================================================================================================================================================
// 11  MATCH
// =====================================================================================================================================================================
// Sides: normally team 0 (Blue) defends the left goal and team 1 (Red) the right. Every SWAP_EVERY points they trade places (see maybeSwapSides in game/rules.js).
// sideSwap(n) turns a team into the side it is on (0 left, 1 right) and a side into the team on it: swapping is its own inverse, so one function does both.
let sidesSwapped = false;             // true while the teams have traded sides (changes during a match; not a tuning number)
const sideSwap = n => (sidesSwapped ? 1 - n : n);