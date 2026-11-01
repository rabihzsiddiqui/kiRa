# Handoff: what to build next

The gameplay core is done and tested: input buffer, intent resolver, player FSM, hit resolution, perfect dodge/block, time scaling, targeting, and a reference motor. `npm run check` passes 127 tests.

Phases 1 to 7 are done. `npm run dev` runs the browser sandbox.

Everything below is the presentation and world layer. Work the phases in order. Each one ends playable.

### Starter prompt for Claude Code

> Read CLAUDE.md, docs/ARCHITECTURE.md and docs/HANDOFF.md. Then do Phase 1. Keep the gameplay core in src/ engine-agnostic: the browser build goes in src/render and src/app and only talks to the core through the interfaces in src/player/contracts.ts. Run `npm run check` before you finish.

---

## Phase 1: browser sandbox

**Stack:** Vite, three.js (including its post-processing add-ons), `@dimforge/rapier3d-compat` (kinematic character controller).

- `src/app/main.ts`: fixed-step loop exactly as in ARCHITECTURE.md §2 (accumulator, 60 Hz sim, render interpolated).
- `src/input/devices/`: keyboard + mouse and Gamepad API, both producing `RawInputSample`. Latch one-frame taps.
  - Keyboard: WASD move, mouse look, J attack, Space evade, K block, Shift/right mouse target. Jump attack is Space while locked on (neutral or forward stick).
  - Gamepad: left stick, right stick camera, X attack, A evade, RB block, LT target (by position, so PlayStation is square / cross / R1 / L2). Any connected pad works, standard mapping or not; prompts and the overlay follow the last device used and the pad's family. Rumble on perfect dodge, perfect block, hits and hurt. Pad debug: start pause, back overlay, d-pad up AI, d-pad left/right strings, d-pad down hit areas. Layout logic is pure and tested in `test/padLayout.test.ts`.
- `src/physics/RapierMotor.ts` implementing `CharacterMotor`.
- `src/render/ThreeAnimator.ts` implementing `Animator` (log clip names until real animations exist).
- Scene: dark arena floor, fog, one capsule player with a box katana on the right hand, one training dummy.

**Done when:** you can run, roll, lock on, and see the FSM state change in a debug overlay.

**Status: done.** Notes for later phases:
- Devices live in `src/app/input/`, not `src/input/devices/`, so `src/input` stays DOM-free (CLAUDE.md hard rule 1).
- Planar y maps to three.js -Z (`src/physics/space.ts`). Use `planarTo3` / `yawFromFacing`, don't flip signs by hand.
- `RapierMotor` has snap-to-ground off: in Rapier 0.21 it sinks a resting capsule into the floor. Revisit with slopes.
- `H` fakes a hit from the dummy at the combat-overlap slot in `Game.step()`. Phase 3 replaces it with `CombatWorld`.
- Post-processing: see Phase 5 (three's own add-ons, no extra package).
- Arena layout (`src/app/arena.ts`) feeds both Rapier colliders and meshes.

## Phase 2: camera

Build `src/camera/CameraRig.ts` per ARCHITECTURE.md §7. It reads `TargetingQuery` and listens to events. It does not touch the player FSM.

**Done when:** lock-on keeps both characters framed while circle-strafing at any distance up to the break range, breaking lock eases back with no snap, and the camera never clips through walls.

**Status: done.** Each "done when" is a test in `test/camera.test.ts`. Notes:
- `CameraRig` is engine-free (it outputs a `CameraPose`), so it sits inside the core guard rails. `src/render/CameraView.ts` copies the pose onto the three.js camera.
- Collision goes through the `CameraCollider` interface; `src/physics/RapierCameraProbe.ts` sphere-casts against level geometry only (floor, walls, pillars), never characters.
- The §7 event hooks are in: perfect dodge FOV punch + dutch roll, perfect block shake + push in, counter dolly. They arrive as `FxSink` cues, and shake/roll are off under prefers-reduced-motion. Phase 5 tunes the numbers (`FX` in `CameraRig.ts`).
- Lock framing knobs: `lockYawOffset`, `lockShoulderOffset`, `lockDistancePerMeter`. At very close range (under 2 m) her body can cover part of the dummy; widen the yaw offset if that bugs you in play.
- In dev builds the running game is on `window.__kira`. Headless browsers advance rAF time slower than the wall clock, so scripted playtests should wait on `__kira.frame`, not milliseconds.

## Phase 3: combat overlap

`src/combat/CombatWorld.ts`, implementing `CombatSink`:
- Build hit shapes from `AttackDef.hit` (`arc`, `line`) in her facing.
- One hit per target per swing.
- Enemy to player: call `player.receiveHit()`. While she is in `Evade`, test a hurtbox inflated by about 0.75 m so near misses count as perfect dodges.
- On `'perfectBlock'`: stagger the attacker and apply poise damage. On `'blocked'`: small recoil.
- Enemy `Poise` component: `poiseDamage` fills it, full = stagger/knockdown.

**Done when:** each attack's hit area is drawn in debug view and matches the arc/line in the data.

**Status: done.** Notes:
- `src/combat/hitShapes.ts` holds the overlap math and `shapeOutline()`. The debug view draws the outline and a test checks it agrees with the overlap test for every attack.
- `CombatWorld` runs once per sim frame after enemies update. One hit per target per swing; an enemy swing that reaches her during i-frames is spent.
- The 0.75 m graze margin is on only while `PlayerController.inPerfectDodgeWindow` is true. Inflating it for the whole evade would turn near misses late in a roll into hits.
- Perfect block parries (short, weapon thrown back, 30 poise) instead of a long stagger, so a 3-hit string can still be perfect-blocked hit after hit in Phase 4. A full poise meter is the stagger. Normal block makes the enemy recoil. Phase 4's AI decides whether a parry or recoil ends its string.
- Her hits do not interrupt enemy swings unless poise breaks (training dummy behaviour; tune per enemy later).
- Debug keys: `H` the dummy turns and swings (120 degree arc, 2.5 m), `V` hit areas, `P` pause the sim.
- No hit stop or VFX on her hits yet; `CombatWorld.events` (`enemyHit`, `playerHit`, `enemyStaggered`) is there for Phase 5 to hook into.

## Phase 4: training dummy AI

A dummy that loops attack strings so the timing windows can be practiced.
- Telegraph: a weapon glint at wind-up start. Unblockable attacks get a red glow.
- Strings: single slash, 3-hit combo (to test perfect block chaining), delayed overhead, unblockable thrust.
- Tunable wind-up times in data.

**Done when:** all four strings run, and perfect dodge/block trigger reliably when timed.

**Status: done.** Notes:
- `src/enemies/strings.ts` holds the four strings as data (windup / active / recovery per step, telegraph flag, unblockable flag). `src/enemies/TrainingDummyAI.ts` runs them on the world clock and only talks to the enemy through `Enemy.startSwing()`.
- It tracks her during windup and stops turning 0.2 s before the strike, so a late sidestep is fair. It engages within 4.5 m (she spawns at 5 m).
- Parries and blocked hits do not end a string; a poise break does. Enemy recoil and parry times are 0.15 s so a combo's next hit still lands inside her PerfectBlock state: one well-timed block chains all three hits.
- Tests sweep every frame of the windows: perfect block works pressed 1 to 7 frames early and not at 9+; perfect dodge on the unblockable works 1 to 8 frames early.
- Telegraphs are event driven (`telegraph`, `strike`, `stringEnd` on `TrainingDummyAI.events`): a glint on the arm tip, and a red glow while an unblockable step winds up. Both are placeholders for Phase 5.
- Debug keys: `H` AI on/off, `1` to `4` repeat one string, `0` cycle all four.

## Phase 5: the spectacle (Stellar Blade layer)

Implement `FxSink` in `src/render/ThreeFx.ts`. Gameplay already fires the cues and drives slow-mo. This phase is pure presentation.

### `perfectDodge`
- World desaturates to about 30% with a cool indigo tint. She stays full color (mask her out, or boost her rim light).
- 4 to 6 afterimages along her flip path: additive cyan fresnel copies of her pose, fading over 0.4 s.
- 0.15 s pulse of chromatic aberration and radial blur centered on her.
- Camera: FOV +8° with a slight dutch roll, easing back with the slow-mo.
- Audio: low-pass on world sound and music, a reversed whoosh, one heartbeat thump.
- A small attack glyph pulses beside her while the counter is available (UI copy in lowercase).

### `perfectBlock`
- 1 to 2 frame white flash at the blade contact point.
- Spark burst (orange-white, 100+ particles) and a ground shockwave ring.
- Short high-frequency camera shake, then a 5% push in.
- Enemy weapon thrown back, poise bar flashes.
- Audio: metal clang over a bass impact. Each chained block (`chain`) pitches up a step.

### `counter.phantomDash`
- She partly dissolves mid-dash with a streak trail along the path.
- Slash arc in an aurora gradient (indigo to cyan).
- Iaido beat: on hit, the slash lines appear first and the cut sound lands about 0.15 s later.

### `counter.overpower`
- Two-handed overhead, ground crack decal, heavy thud. Knockdown if poise breaks.

### `slowmo.end`
- Ease all post-processing back to neutral over the same ease-out time.

**Done when:** a perfect dodge into Phantom Dash reads as one dramatic beat, and ordinary hits look nothing like it.

**Status: done.** Notes:
- Post-processing uses three's own add-ons (`three/addons/postprocessing`: EffectComposer, UnrealBloomPass, a custom grade ShaderPass, OutputPass), not the `postprocessing` package: its latest release only supports three below 0.187. Same effects, no extra dependency.
- `src/feel/PostGrade.ts` decides the look (saturation, indigo tint, aberration, radial blur, world low-pass) from cues plus the world clock, so it eases out exactly with the slow-mo, including a counter's early release. Hit stops hold the grade instead of flashing it. Tested headless in `test/spectacle.test.ts`.
- She keeps her color through the grade via a mask: her meshes (and afterimages) sit on `KEEP_COLOR_LAYER` in `src/render/PostFx.ts`.
- `src/render/ThreeFx.ts` draws everything else. Sparks, shockwaves and the ground crack run on the world clock (they hang in slow-mo); flashes, afterimages, the aurora arc and slash lines run on real time.
- `CombatFeel.attachCombat()` adds hit stop when her hits land (0.035 s ordinary, 0.09 s counters, 0.12 s posture breaks) and a `hit` cue carrying the attack id, so counters can look nothing like ordinary hits.
- Audio is procedural Web Audio (`src/audio/SoundFx.ts`), no files. It starts on the first key press or click. World sounds (dummy telegraphs) go through the low-pass; hers stay clear. `M` mutes.
- Overpower knockdown is presentation only (the dummy tips far back when an Overpower breaks posture). The dummy has a poise bar that flashes on perfect blocks.
- Debug: `P` now freezes effects too, while the camera still orbits. In dev builds `window.__kiraFx` exposes the effects layer for triggering effects by hand.
- Tune on a real GPU: bloom strength (`PostFx`), spark counts and lifetimes (`ThreeFx`), and the `FX` numbers in `CameraRig`.

## Phase 6: character

- Placeholder rigged female model, katana parented to the right-hand bone, tunic.
- Ponytail per ARCHITECTURE.md §8 in `src/character/Ponytail.ts`. Unit test the chain: it settles under gravity and never exceeds its segment lengths.
- Map every `animator.play()` clip name in the states to real or placeholder clips.

**Status: done.** Notes:
- The placeholder is built in code, no model file: `src/character/rig.ts` (bone hierarchy and proportions, Mixamo bone names) and `src/render/CharacterFigure.ts` (rigid meshes on the bones, tunic, hair, katana on the right-hand bone). A skinned glTF with Mixamo names can replace it without touching the clips.
- All 24 clip names the states use are in `src/character/clips.ts`, written as plain functions of time (poses per bone, timed from `moves.ts`). `ThreeAnimator` samples them into three.js clips and runs an AnimationMixer on the player clock: crossfades use the blend time each state asks for, and 'locomotion' blends idle, run and four strafe clips from the setFloat params. `test/character.test.ts` fails if a state asks for a clip that does not exist.
- Ponytail per §8 in `src/character/Ponytail.ts`: 7 segments, 120 Hz substeps on the player clock, follow-the-leader lengths (it cannot stretch), cone limit, weak rest pull, head/neck/back collision spheres, and a root clamp so a 9 m dash carries it instead of whipping it.
- `/gallery.html` (dev only) shows every clip on its own figure. `?at=0.4` freezes them at 40%, `?only=atk` filters by name. Use it to tune poses.
- Clip poses are a first pass, good enough to read each move. Tune them in the gallery, or swap in real animations.

## Phase 7: debug HUD

Dark, minimal overlay (indigo/cyan accents):
- Current state, attack phase, time in state
- Buffered presses with age bars against the buffer window
- Perfect windows as live bars (dodge, block)
- Time scales (world / player)
- Toggles: hitbox view, slow-mo off, infinite perfect window (for testing VFX)

**Status: done.** Notes:
- Two panels (`src/app/DebugOverlay.ts`), `tab` or pad back hides both. Left is live state: FSM state, time in state, the move (attack + phase + combo step, or evade + its clock), input buffer, perfect windows, clocks, toggles. Right is the logs (transitions, combat, fx cues) and the controls for the active device.
- Everything the HUD shows comes from core readouts, tested headless in `test/debugHud.test.ts`: `InputBuffer.pending` (waiting presses), `PlayerController.attack` and `PlayerController.perfectWindows()` (time left in each window, 0..1, plus a flag when mashing voided the block window).
- Buffer bars show how much of the 0.2 s window each waiting press has left. A press that fires on the frame it lands never shows up; that is the point, only presses held over (mid-roll, mid-slash) appear.
- Perfect window bars are not eased, so you can see how short 9 frames is. `mash` on the block row means the anti-mash lockout ate the window.
- Toggles: `V` / d-pad down hit areas, `N` / left stick click slow-mo, `I` / right stick click infinite perfect window. Slow-mo off (`CombatFeel.slowmo`) skips the perfect dodge, perfect block and counter slow-mo but keeps hit stops and every cue. Infinite perfect (`PlayerController.infinitePerfectWindows`) makes every evade and guard perfect, and puts the tuned windows back when turned off.

### Movement and animation notes
- Running stutter fix: the animation mixer now advances at render time to the same in-between moment the renderer draws her position at (`ThreeAnimator` deferred mode, `render(alpha)` from `main.ts`). Before, a display frame that landed on 0 sim steps froze her pose and the next one jumped two. The camera also reads her interpolated facing, and the ponytail update makes no garbage per frame.
- Lock-on strafing uses its own stance (`STANCE` in `clips.ts`: two hands, blade at the target's eyes). Blocking is a high horizontal guard (`GUARD`: blade level above her head, left palm under it). They no longer share arm poses.
- The roll is a ground roll: dive, one turn balled up about the middle of the tuck (`hipsZ` moves the hips around that point), then up onto the feet. Each frame is placed on the floor by `src/character/fk.ts`, a small engine-free forward kinematics helper (`onGround`, `lowestPoint`). The sword turns out to her right, along the roll's axis, so it never digs into the floor. Tested in `test/character.test.ts`.
- `onGround()` also places the kneeling cleave, the lunge and the new combo poses, so their feet sit on the floor. Older poses still sink about 5 cm because feet tilt with the knees (no ankle posing yet); worth a pass when real animations arrive.
- Spin attack turns the way the stick went: a clockwise 360 gives `SpinClockwise` (backhand, turning right), counterclockwise gives `Spin` (forehand, turning left). Charged spins use `Spin`. Both clips are coil, one low wide turn with the blade level, follow-through.
- Spin charge: the body holds a steady coil (no more full-body tremble). `src/render/BladeCharge.ts` reads `PlayerController.spinCharge` (0..1) and draws a sparkle running hilt to tip with a faint trail, a blade tremble that grows with the charge (off under reduced motion), then a flare and a blooming energy glow plus a small light on her once charged, held through the spin. Tagged noGhost so afterimages skip it.
- Lock-on vignette: `PostGrade` eases a `vignette` value in over 0.25 s while targeting and out over 0.45 s; the grade shader darkens the edges toward deep indigo. Tested in `test/spectacle.test.ts`.
- Character v2, in the spirit of EVE, 2B and Zero Suit Samus in our palette. Proportions in `src/character/rig.ts`: about 7.5 heads tall, hips at 0.98 m (long legs), narrower shoulders, a longer slender neck, a high ponytail tie. Clips are angles, so they all still fit. `CharacterFigure.ts` adds: a bigger head with hair volume, eyes with whites, indigo irises and lash lines, subtle lips, a natural skin tone (the zinc-200 skin read as a porcelain doll), a fringe and face-framing locks built from tapered strands, a choker, gloves, a left pauldron, knee guards, piping that follows each limb's profile, and flush boot soles. The skin tone is the one color outside the palette; change `PALETTE.skin` to go back.
- Ponytail hangs straight down under gravity (no pull toward a rest angle) and drapes over the back of her head from the high tie. Wobble is damped relative to the tie, air drag is light, and dynamic follow-the-leader velocity correction (Mueller et al. 2012) stops the tip whipping. Tested: settles straight, drapes, stays smooth at uneven frame rates.
- Mobile: `src/app/input/TouchControls.ts` (DOM) and `touchLayout.ts` (pure, tested). Floating left-thumb joystick, drag right to look, atk / evade / block / lock buttons, hud / ai / pause / full pills. A third device in `Devices`, shown only on touch-first devices (coarse pointer). The lock button latches Target and lets go on its own if nothing gets targeted, so a tap with nothing in range recenters the camera. On phones the hud starts hidden and rendering is capped at 1.5x pixel density. Portrait shows "turn your phone sideways".
- PWA: `public/manifest.webmanifest` (fullscreen, landscape), icons in `public/icons/` (192, 512, maskable, apple touch), `public/favicon.svg`, and `public/sw.js` (pages network first, assets cache first with background refresh; bump `CACHE` after breaking changes). Registered in production builds only. Checked in `test/pwa.test.ts`; verified offline after one visit with `vite preview`.
- Character model rebuilt in `src/render/CharacterFigure.ts` on the same bones: lathe-profiled limbs and torso (tapered thighs, calves in knee boots, shaped arms with bracers, fingers round the grip), one sculpted head mesh (jaw, chin, nose, eyes, brows, ears), fringe and hair cap, and a tunic with a sash. The skirt is four panels hinged at the waist that swing out of the way of her thighs (`updateCloth`, called from `PlayerView.sync`).
- Ponytail is drawn as a braid (instanced lobes along a smooth curve, a tie and a tuft). The fidgeting had two causes, both fixed and tested: the run bounce had a sharp kink at each footfall (now a smooth curve), and the 120 Hz chain saw the head jump once per frame instead of moving across its substeps. `Ponytail.renderPoints` also blends between substeps and pins the root to the head. Light air drag calms it further.
- `/gallery.html` takes `?zoom=`, `?yaw=` and `?y=` for close-ups of the model (`?at=` is a fraction of each clip, not seconds).
- Roll steering: `EvadeDef.steerRate` (rad/s) lets the stick bend an evade after it starts. The roll steers at 3 rad/s (up to about 120 degrees over the whole roll) and she turns with it; hops and the backflip are 0, so they commit. Tested in `test/combat.test.ts`.
- Roll tuning: 0.7 s at 8.5 m/s (was 0.5 s at 7 m/s, barely faster than the 6 m/s run, while cramming a whole flip into half a second). It now covers clearly more ground than running for as long (tested). I-frames unchanged (0.04 to 0.3 s); the cancel window opens at 0.58 s.
- Dive roll clip: crouch, push off, dive onto the free hand (tipped about 85 degrees at 0.2 s, legs long behind her, airborne briefly), the catch (the arm bends and lowers her onto the back of her shoulder, chin tucked, sword arm kept in), the tucked turn, the rise. Keys are blended along a Catmull-Rom curve (`splined` in `clips.ts`). The spin speeds up through the dive and eases out to a stop as her feet come under her. Hip height is no longer snapped to the floor every frame (that jumped whenever a different body part became the lowest): `smoothedFloorHeights` samples the exact heights, then blurs them a few times, never letting her sink more than 1.8 cm. Peak hip acceleration went from about 5700 to under 600 m/s^2. Tested in `test/character.test.ts` (floor contact, smoothness, the dive's phases).
- Character v3, after the reference art: a faceless head and a short dark bob (since replaced by the anime head, below), a midnight indigo tunic (was forest green; changed so it doesn't read as Zelda) with a cream front panel and gold trim (painted on a canvas texture, plain indigo in headless tests), a standing collar, short indigo sleeves over cream undersleeves, a leather harness, a wide belt with a buckle and tail, a sword belt slung to the left hip with the empty scabbard, long bracers, fingerless gloves, dark trousers and tall brown boots with turned-down cuffs. The bob is one shell (`bobGeometry`) whose vertex alpha cuts out the face, with locks laid on it via `onBob`, and the fringe edge set by `fringeY`. This replaces the indigo v2 outfit, the ears, and the ponytail (removed with its tests; see ARCHITECTURE.md §8).
- Sword trails: every swing leaves a ribbon swept by the blade while it is live (the attack's active phase). The look is data in `src/feel/swingTrail.ts` (engine-free, tested in `test/swingTrail.test.ts`): basic swings are a thin, quick indigo arc; enders, spins and the jump attack a wider gold arc that lingers, reaches past the tip and shimmers with moving bands and glints; the Phantom Dash and Overpower counters are cyan. `src/render/SwordTrail.ts` draws it in world space with additive blending, joining each frame's blade position to the last along a Catmull-Rom curve so fast swings stay round. It ages on her clock, so trails hang in the air during slow-mo. The fragment shader clamps everything it feeds to `pow()` and its output: a NaN pixel in the half-float scene buffer was being spread by bloom into black flicker (reproduced headless: 2 of 288 combo frames had big black areas before the fix, none after). The gallery draws trails too (`?at=` steps up to the frozen moment).
- Anime head: "Anime head" by DaGreen (Sketchfab, CC-BY-4.0, credited in the README) replaces the sculpted faceless head and the bob. The file is `public/models/anime_head.glb` (one textured mesh, about 190 KB, cached by the service worker). `src/render/AnimeHead.ts` loads it once per page and bakes a placement into the geometry: turned to face -Z, scaled to anime proportions (0.28 m chin to crown, about 6.3 heads tall; the old realistic head was 0.22 m), sunk so the chin sits 2.5 cm below the head joint and just above the collar (keeps the neck short), neck stump centered on the neck bone. The roll's floor-contact sphere for the head (`BODY` in `src/character/fk.ts`) grew to match. Each figure creates its head mesh up front with an empty geometry and its own lit material (white, so the painted texture shows; part of the dissolve list), and the geometry and texture drop in when the file arrives. No DOM (headless tests) means no load. Body skin is now the texture's skin (`#b7877a`) with the same roughness, so neck and hands match the face. Placement tested against the real file in `test/animeHead.test.ts`. No hair yet: that's next, built to fit this head.
- Skinned body: her body is now "Female_2500_ Base Mesh" by EbiosDesigner (Sketchfab, CC-BY-4.0, credited in the README), `public/models/base_body.glb`. The file has no skeleton, so `src/character/bodyFit.ts` (engine-free, tested against the real file in `test/bodyFit.test.ts`) rigs it at load in under 0.1 s:
  - Weights: arms and legs are found by shape (below the armpits each arm is its own connected piece of the mesh, below the crotch each leg), weights blend bone to bone along each limb, the torso blends up the spine and hands over to thighs near the crotch and to shoulders and upper arms near the armpits, then 8 smoothing passes over the mesh's edges.
  - Fit: each bone maps its stretch of the mesh (landmarks measured from cross sections, `MESH_JOINTS_R`) onto its rig bone (joint to joint, stretched to length, girth x1.05), blended by the weights. This swings the A-pose arms down to the rig's rest pose, so the bind pose is the rest pose and bone inverses are just the rest joints.
  - The mesh keeps its own head for now (`fitBody(..., { keepHead: true })`); the anime head is only on the classic body. `keepHead: false` cuts the neck for a separate head model. Fingers are curled around the grip with a bend deformer (`curlFinger`), and the sword moves to the fist's center on this body.
  - `src/render/SkinnedBody.ts` makes the `SkinnedMesh` up front (empty geometry with a normal attribute: a material first compiled without normals is built flat shaded and keeps it) and drops the fitted geometry in on load.
  - Outfit: painted by the shader (`src/render/BodyOutfit.ts`) from each pixel's rest position, plus distance along the arm (`aArm`) so the sleeves, bracers and gloves never bleed onto the hips. Edges stay crisp on a low-poly body. Skirt panels, sword belt, scabbard and katana are still geometry, sized for the wider hips.
  - Afterimages use the skeleton-aware clone (`SkeletonUtils.clone`) and a ghost shader with skinning chunks, so ghosts keep the pose they were made in.
  - Shells (`src/character/shell.ts`): armor plates, straps and hair are all thin solids measured off the fitted body: a grid of points on it, an outward direction, outer and inner offsets, per-cell trim, weights copied from the nearest body vertices (limited to chosen bones). `shellGeometry()` in `SkinnedBody.ts` builds any of them (outer and inner surfaces, walls on open edges, winding detected automatically).
  - Armor over the painted tunic (`src/character/armorFit.ts`, tested): a front plate and a back plate, both ending just under the bust (y 1.2), each spanning about +-69 degrees around its middle, so each side is left open (cloth, about 42 degrees) for mobility. Two leather straps a side (y 1.225 and 1.29, gold buckle in the middle) cross the gap and tuck under both plates' edges. Plates are made convex both ways (straight across between the breasts, straight down), with a low center ridge and a rolled gold edge; spine bones only, so they stay rigid.
  - Hair (`src/character/hairFit.ts`, tested): a 2B-style bob as one shell on her head, no physics. Side parted on her right (`HAIR.part`): the fringe is short by the part (`fringeHigh`) and sweeps across the forehead, longer as it goes, to eye level on her left (`fringeLow`), where it blends into that side's lock (`sweepTo` to `sweepLock`); a lock falls straight from just past the part. A groove runs back over the crown along the part (`partX`, `partDepth`) with a small lift on the swept side. Face-framing locks end just under the chin (`locks`), shorter at the back (`nape`), ends tuck in. Over the crown it follows the scalp; below the head's widest line it falls straight, pushed out only past ears and cheeks, so it hangs like hair instead of wrapping like a helmet. Matte. Weights from neck and head.
- Katana (`src/render/Katana.ts`, tested in `test/katana.test.ts`): modeled from cross-sections along the blade (edge, hamon band, flat, shinogi ridge, shinogi-ji, peaked spine), each facet its own strip so ridge lines stay crisp; tapers in width and thickness, curves gently (the middle bows toward the edge, hilt and tip stay on the axis so trails and the charge glow line up), and ends in a kissaki whose edge arcs up to a sharp point on the spine. Mounting: gold habaki, seppa either side of an oval iron tsuba with a gold rim, gold fuchi, a grip wrapped in black cord over pale ray skin (canvas texture, diamonds), gold menuki, iron kashira. Edge faces -Y. `PlayerView.bladeTip` and the slash test now use the sword layout (`tipZ`) instead of the blade's box size.
  - Pauldrons (`pauldron()` in `CharacterFigure.ts`): one solid steel dome tipped outward, with an inner shell for thickness, a rolled gold rim and a gold band over the crown, hung at the shoulder joint and turned 45% of the upper arm's rotation each frame (`updateCloth`), so a raised arm lifts them without throwing them off the shoulder.
  - A torso weighting fix: the shoulder rule (high and out to the side) used to catch the sides of the head and pinch it narrow; it now stops above the shoulders.
  - `?body=classic` on the game or the gallery shows the original shape-built body for comparison (`buildFigure(body)`). Pick one and delete the other when settled.
- Spin attack rework:
  - Edge first: the katana has one edge (the hand's -Y), and flat cuts were sweeping with the flat. `armOut()` in `clips.ts` takes an `edgeRoll` (forearm roll): `FOREHAND` -90 for right-to-left swings, `BACKHAND` 90 for left-to-right. Used by the horizontals, both spins, the spinning ender and the Phantom Dash; the rising cut rolls 140 so the edge leads upward. `test/swordEdge.test.ts` checks every non-thrust cut leads with the edge (edge . blade velocity over the active window).
  - Faster: Spin and SpinClockwise are 0.04 s startup, 0.22 active, 0.24 recovery (0.5 s, was 0.78), cancels at 0.4. The spinning ender is 0.58 s (was 0.74).
  - Bigger reach, shown by a circle of energy: both spins hit out to 3 m (was 2.4; a normal swing is 2), during the swing. The blade keeps a gold trail, but its own faint `spin` tier (same colors as `special`, intensity 0.2) so the eye goes to the wave; on top, a wave (`spinWave()` / `wavePoints()` in `src/feel/swingTrail.ts`, engine-free) lays a 60 cm band whose outer edge is the hit range, at the blade's height, pointing where the blade points. It is drawn by the same `SwordTrail` renderer fed a different `TrailSource` (`waveSource` in `src/render/SwordTrail.ts`; the default `bladeSource` is the blade), so it sweeps round with the blade and closes into a circle round her. It is shaded as energy, not steel: the source's `look: 'energy'` picks `ENERGY_FRAG`, in the charge's cyan, with a hot rim at the reach line, a soft glow fading out both sides, streaks flowing along the ring (each point carries `along`, meters from the swing's start) and a burn-out as it ages. The band is flat, so a second, upright band (`waveWall()`, `waveSource(..., 'wall')`) crosses it along its hot line, 40 cm tall (`thickness`), giving it real thickness side-on; `spinWaveTrails()` makes both, and the hot line's position is a shader uniform (`uRim`: 0.8 on the band, the middle on the wall). The front of the ribbon fades in so it tapers instead of ending in a flat cut. Between frames `waveSource.between` steps round her by angle (every 0.035 rad) at a fixed radius, so it stays a true arc; the trail holds 320 points so a whole turn fits. Tested in `test/spin.test.ts` (radius = hit range, follows the blade's direction and height, only spins have one, the hit lands while the blade is live) and `test/spinWave.test.ts` (energy look and colors, every point on the reach line, small steps, a full turn kept, the upright band's height and place). Brightness and width: `WAVE_STYLE` and `width` in `swingTrail.ts`.
  - Blade charge on the new katana: the glows were straight boxes sized for the old blade (a glowing rod beside the curved steel). `BladeCharge` now uses shells built from the katana's own profile (`bladeProfile`, `bladeShell` in `Katana.ts`: curve, taper and point, padded out), filling hilt to tip with the charge (draw range by slice), and the sparkle, motes and light ride the blade's curved middle (`bladeMiddle`).
- Combo system: see ARCHITECTURE.md §4 "Combos". New swings: vertical left (`\`), thrust left, and four enders (spin, rising, cleave, lunge). Enders get a 0.06 s hit stop (`finisherHitStop`).
- The traversal roll (any roll, since rolls only happen unlocked) eases into the run speed the stick is asking for instead of stopping, so rolling while running keeps her momentum. With the stick released it still eases to a stop. Side hops and backflips (locked on) still stop so landings don't skate.

---

## Open tuning questions (playtest these)

- Perfect dodge window 0.15 s and perfect block 0.12 s. Stellar Blade on normal feels a little wider.
- Should a perfect dodge counter be possible without lock-on? Currently yes, it aims at the attacker.
- Resolved: jump attack is Evade (neutral/forward) while locked on, so the Attack + Evade chord and its 3-frame wait are gone. Locked-on presses now fire on the frame they land.
