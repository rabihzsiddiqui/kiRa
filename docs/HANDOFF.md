# Handoff: what to build next

The gameplay core is done and tested: input buffer, intent resolver, player FSM, hit resolution, perfect dodge/block, time scaling, targeting, and a reference motor. `npm run check` passes 26 scenario tests.

Phases 1 to 5 are done. `npm run dev` runs the browser sandbox.

Everything below is the presentation and world layer. Work the phases in order. Each one ends playable.

### Starter prompt for Claude Code

> Read CLAUDE.md, docs/ARCHITECTURE.md and docs/HANDOFF.md. Then do Phase 1. Keep the gameplay core in src/ engine-agnostic: the browser build goes in src/render and src/app and only talks to the core through the interfaces in src/player/contracts.ts. Run `npm run check` before you finish.

---

## Phase 1: browser sandbox

**Stack:** Vite, three.js (including its post-processing add-ons), `@dimforge/rapier3d-compat` (kinematic character controller).

- `src/app/main.ts`: fixed-step loop exactly as in ARCHITECTURE.md §2 (accumulator, 60 Hz sim, render interpolated).
- `src/input/devices/`: keyboard + mouse and Gamepad API, both producing `RawInputSample`. Latch one-frame taps.
  - Keyboard: WASD move, mouse look, J attack, Space evade, K block, Shift/right mouse target. Jump attack is Space while locked on (neutral or forward stick).
  - Gamepad: left stick, right stick camera, X attack, A evade, RB block, LT target.
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

## Phase 7: debug HUD

Dark, minimal overlay (indigo/cyan accents):
- Current state, attack phase, time in state
- Buffered presses with age bars against the buffer window
- Perfect windows as live bars (dodge, block)
- Time scales (world / player)
- Toggles: hitbox view, slow-mo off, infinite perfect window (for testing VFX)

---

## Open tuning questions (playtest these)

- Perfect dodge window 0.15 s and perfect block 0.12 s. Stellar Blade on normal feels a little wider.
- Should a perfect dodge counter be possible without lock-on? Currently yes, it aims at the attacker.
- Resolved: jump attack is Evade (neutral/forward) while locked on, so the Attack + Evade chord and its 3-frame wait are gone. Locked-on presses now fire on the frame they land.
