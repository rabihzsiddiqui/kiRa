# Handoff: what to build next

The gameplay core is done and tested: input buffer, intent resolver, player FSM, hit resolution, perfect dodge/block, time scaling, targeting, and a reference motor. `npm run check` passes 119 tests.

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
- Character model rebuilt in `src/render/CharacterFigure.ts` on the same bones: lathe-profiled limbs and torso (tapered thighs, calves in knee boots, shaped arms with bracers, fingers round the grip), one sculpted head mesh (jaw, chin, nose, eyes, brows, ears), fringe and hair cap, and a tunic with a sash. The skirt is four panels hinged at the waist that swing out of the way of her thighs (`updateCloth`, called from `PlayerView.sync`).
- Ponytail is drawn as a braid (instanced lobes along a smooth curve, a tie and a tuft). The fidgeting had two causes, both fixed and tested: the run bounce had a sharp kink at each footfall (now a smooth curve), and the 120 Hz chain saw the head jump once per frame instead of moving across its substeps. `Ponytail.renderPoints` also blends between substeps and pins the root to the head. Light air drag calms it further.
- `/gallery.html` takes `?zoom=`, `?yaw=` and `?y=` for close-ups of the model.
- Combo system: see ARCHITECTURE.md §4 "Combos". New swings: vertical left (`\`), thrust left, and four enders (spin, rising, cleave, lunge). Enders get a 0.06 s hit stop (`finisherHitStop`).
- The traversal roll (any roll, since rolls only happen unlocked) eases into the run speed the stick is asking for instead of stopping, so rolling while running keeps her momentum. With the stick released it still eases to a stop. Side hops and backflips (locked on) still stop so landings don't skate.

---

## Open tuning questions (playtest these)

- Perfect dodge window 0.15 s and perfect block 0.12 s. Stellar Blade on normal feels a little wider.
- Should a perfect dodge counter be possible without lock-on? Currently yes, it aims at the attacker.
- Resolved: jump attack is Evade (neutral/forward) while locked on, so the Attack + Evade chord and its 3-frame wait are gone. Locked-on presses now fire on the frame they land.
