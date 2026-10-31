/**
 * Generic finite state machine. Knows nothing about players or combat.
 *
 * Rules:
 *  - A state returns a Transition from update() to request a change.
 *  - enter() runs immediately on change, so the new state sets up on the same frame.
 *  - At most one transition per update(), which keeps frame traces easy to debug.
 *  - transition() lets outside systems force a change (getting hit, dying, cutscenes).
 */
export interface Transition<Id extends string> {
  to: Id;
  params?: unknown;
}

export interface State<Id extends string, Ctx> {
  readonly id: Id;
  enter?(ctx: Ctx, params: unknown, from: Id | null): void;
  update(ctx: Ctx, dt: number): Transition<Id> | void;
  exit?(ctx: Ctx, to: Id): void;
}

export class StateMachine<Id extends string, Ctx, S extends State<Id, Ctx> = State<Id, Ctx>> {
  private states = new Map<Id, S>();
  private _current: S | null = null;
  private _time = 0;

  onTransition?: (from: Id | null, to: Id, params: unknown) => void;

  constructor(private readonly ctx: Ctx) {}

  add(state: S): this {
    this.states.set(state.id, state);
    return this;
  }

  start(id: Id, params?: unknown): void {
    this.change(id, params);
  }

  get current(): S {
    if (!this._current) throw new Error('StateMachine not started');
    return this._current;
  }

  get currentId(): Id {
    return this.current.id;
  }

  /** Seconds spent in the current state. */
  get timeInState(): number {
    return this._time;
  }

  update(dt: number): void {
    this._time += dt;
    const t = this.current.update(this.ctx, dt);
    if (t) this.change(t.to, t.params);
  }

  transition(to: Id, params?: unknown): void {
    this.change(to, params);
  }

  private change(to: Id, params: unknown): void {
    const next = this.states.get(to);
    if (!next) throw new Error(`Unknown state "${to}"`);
    const from = this._current?.id ?? null;
    if (this._current) this._current.exit?.(this.ctx, to);
    this._current = next;
    this._time = 0;
    this.onTransition?.(from, to, params);
    next.enter?.(this.ctx, params, from);
  }
}
