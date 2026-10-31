import * as THREE from 'three';
import { PlayerStateId } from '../player/contracts';
import type { Game } from './Game';
import type { Devices } from './input/Devices';

/**
 * Small prompt beside her while a counter is open: Phantom Dash after a perfect dodge,
 * Overpower after a perfect block. Reads the player's state each frame; it never
 * changes gameplay.
 */
export class CounterGlyph {
  private readonly el: HTMLElement;
  private readonly key: HTMLElement;
  private readonly label: HTMLElement;
  private readonly p = new THREE.Vector3();

  constructor(
    parent: HTMLElement,
    private readonly game: Game,
    private readonly devices: Devices,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'counter-glyph';
    this.key = document.createElement('span');
    this.key.className = 'counter-glyph-key';
    this.label = document.createElement('span');
    this.el.append(this.key, this.label);
    this.el.hidden = true;
    parent.append(this.el);
  }

  update(camera: THREE.Camera, herChest: THREE.Vector3): void {
    const state = this.game.player.state;
    const open = state === PlayerStateId.PerfectDodge || state === PlayerStateId.PerfectBlock;
    this.el.hidden = !open;
    if (!open) return;

    const key = this.devices.gamepad.name ? 'x' : 'j';
    const label = state === PlayerStateId.PerfectDodge ? 'phantom dash' : 'overpower';
    if (this.key.textContent !== key) this.key.textContent = key;
    if (this.label.textContent !== label) this.label.textContent = label;

    // Up and to her left: lock-on framing keeps the target on her right.
    this.p.copy(herChest).project(camera);
    const x = (this.p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.p.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(${Math.round(x - 40)}px, ${Math.round(y - 72)}px) translateX(-100%)`;
  }
}
