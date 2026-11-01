# kiRa

Third-person katana combat sandbox. Twilight Princess moveset (Z-targeting, contextual evades, directional slashes, spin attack) plus a Stellar Blade layer (perfect dodge, perfect block, counters, slow-mo). Goal: a combat test sandbox whose architecture scales into a full action-adventure game.

- Architecture and FSM spec: `docs/ARCHITECTURE.md`
- What to build next: `docs/HANDOFF.md`

## Commands

```bash
npm install
npm run dev         # browser sandbox (vite), http://localhost:5173 (clip gallery at /gallery.html)
npm run build       # production build into dist/
npm run typecheck   # tsc, strict, plus a no-DOM pass over the core (tsconfig.core.json)
npm test            # headless scenario tests (node:test + tsx)
npm run check       # both, run before finishing any task
```

## Layout

```
src/core        math, EventBus, TimeController
src/input       Action enum, InputBuffer
src/targeting   Z-targeting
src/combat      move data (moves.ts), direction math, IntentResolver (button -> move table), CombatWorld + hitShapes (overlap), Enemy + Poise
src/fsm         generic StateMachine
src/player      PlayerController, contracts (all interfaces + tuning), states/
src/physics     CharacterMotor implementations (SimpleMotor, RapierMotor), RapierCameraProbe, planar <-> 3D mapping (space.ts)
src/feel        CombatFeel: events -> slow-mo, hit stop, FX cues. PostGrade: cues + world clock -> screen/audio grade
src/enemies     enemy attack strings (data) and TrainingDummyAI. Engine-free, world clock
src/character   rig (bones, Mixamo names), clips (every animation as data), fk (puts poses on the floor), bodyFit (rigs the base body mesh), shell + armorFit + hairFit (armor and hair measured off it). Engine-free
src/camera      CameraRig: orbit, lock-on framing, spring arm, cue reactions. Engine-free, outputs a CameraPose
src/sandbox     HeadlessSandbox (used by tests, shows the frame order)
src/render      three.js: scene, CharacterFigure + PlayerView, dummy view, ThreeAnimator (mixer), CameraView, PostFx, ThreeFx
src/audio       SoundFx: procedural Web Audio, an FxSink like ThreeFx
src/app         browser composition root: main.ts (loop), Game.ts (sim step), arena, devices (keyboard, gamepad, rumble), overlay, gallery.ts
test/           scenario tests driven by frame-by-frame input, motor tests, import boundary check
public/         PWA: manifest, icons, service worker (production builds only); models/ (glTF assets)
```

## Hard rules

1. **The gameplay core stays engine-agnostic.** Nothing in `core, input, targeting, combat, fsm, player, feel, camera, enemies, character` may import three.js, Rapier, the DOM or any renderer. Engine code goes in `src/render`, `src/audio`, `src/app`, `src/physics/Rapier*.ts`, and talks to the core through the interfaces in `src/player/contracts.ts`.
2. **Presentation only reacts to events.** Slow-mo, VFX, camera moves and audio are triggered from `EventBus` events or `FxSink` cues. Never put a timing dependency on presentation inside a state.
3. **Moves are data.** New attack or evade = an entry in `src/combat/moves.ts` (plus a rule in `IntentResolver` if it has a new input). Don't add a state class per attack.
4. **The button-to-move table lives in one place:** `resolveIntent()`. States ask for intent, they don't read buttons for move selection. (Exception: the perfect states latch the counter press directly.)
5. **Three clocks.** Input on real time, player on `playerScale`, world on `worldScale`. Never feed a scaled time into `InputBuffer`.
6. **Every new mechanic gets a headless test** in `test/` using `HeadlessSandbox`. Tests drive frames of input and assert on state, attacks, cues and time scales.
7. Fixed timestep (60 Hz sim). Don't make state logic frame-rate dependent.

## Conventions

- TypeScript strict, no `any`. Small classes, plain data objects.
- Comments explain why. No em dashes in comments, docs or UI text.
- UI copy is lowercase. Visual style: dark, minimal, cool tones (indigo, cyan, aurora gradients), strong typography.
- Keep it practical. Prefer the simple version that ships over a framework.

## Adding a move: checklist

1. Add the id and def to `src/combat/moves.ts` (timings in seconds, cancel windows, poise).
2. If it has a new input, add the rule to `resolveIntent()` and the table in `docs/ARCHITECTURE.md` §4.
3. Name its animation clip in the def.
4. Add a test: input sequence in, expected `sb.attacks` / state out.
