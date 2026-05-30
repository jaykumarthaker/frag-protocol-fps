import type { Input } from '../core/Input';
import { WEAPON_ORDER } from '../weapons/Weapons';

/**
 * On-screen touch controls for phones/tablets. A full-screen DOM overlay that
 * translates gestures into the same virtual input the rest of the game already
 * reads (`Input.setKey` / `setMouse` / `addLook`), so no gameplay code is
 * touch-aware:
 *
 *   left half   — drag to spawn a virtual movement stick (8-way → WASD)
 *   right half  — drag to look (feeds the aim delta)
 *   buttons     — fire / alt / jump / dodge / weapons / pause / scores, plus
 *                 interact + buy in Cash Raid (toggled by `setCashRaid`)
 *
 * The overlay is only constructed on touch devices and shown only while
 * actually playing (Game drives `setVisible`).
 */

/** Touch-look sensitivity vs. raw pixel delta (the sensitivity setting scales
 *  this further). A ~half-screen swipe should turn roughly 90°. */
const LOOK_SCALE = 2.8;
const STICK_RADIUS = 55;     // px the knob can travel from its base
const STICK_DEADZONE = 0.34; // fraction of the radius before a direction fires

const WEAP_SHORT: Record<string, string> = {
  railgun: 'RAIL', shard: 'SHARD', rocket: 'RKT', pulse: 'PULSE',
};

export class TouchControls {
  private root: HTMLDivElement;
  private input: Input;
  private visible = false;

  // movement stick (dynamic — appears where the left thumb lands)
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private moveId: number | null = null;
  private moveBaseX = 0;
  private moveBaseY = 0;

  // look drag
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;

  // Cash-Raid-only buttons
  private interactBtn!: HTMLDivElement;
  private buyBtn!: HTMLDivElement;

  constructor(parent: HTMLElement, input: Input) {
    this.input = input;

    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    parent.appendChild(this.root);

    this.stick = document.createElement('div');
    this.stick.className = 'tc-stick hidden';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-stick-knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);

    // --- action buttons (right-hand cluster + corners) ---
    this.addButton('tc-fire', 'FIRE', (d) => this.input.setMouse(0, d));
    this.addButton('tc-alt', 'ALT', (d) => this.input.setMouse(2, d));
    this.addButton('tc-jump', 'JUMP', (d) => this.input.setKey('Space', d));
    this.addButton('tc-dodge', 'DASH', (d) => this.input.setKey('Dodge', d));
    this.addButton('tc-pause', 'II', (d) => this.input.setKey('Escape', d));
    this.addButton('tc-scores', 'TAB', (d) => this.input.setKey('Tab', d));

    // --- weapon strip (slot order → Digit1..4) ---
    const weapons = document.createElement('div');
    weapons.className = 'tc-weapons';
    this.root.appendChild(weapons);
    WEAPON_ORDER.forEach((id, i) => {
      this.addButton('tc-weap', WEAP_SHORT[id] ?? String(i + 1),
        (d) => this.input.setKey(`Digit${i + 1}`, d), weapons);
    });

    // --- Cash Raid (hidden in deathmatch) ---
    this.interactBtn = this.addButton('tc-interact hidden', 'USE',
      (d) => this.input.setKey('KeyE', d));
    this.buyBtn = this.addButton('tc-buy hidden', 'BUY',
      (d) => this.input.setKey('KeyB', d));

    // movement / look live on the overlay backdrop (buttons stop propagation)
    this.root.addEventListener('touchstart', this.onStart, { passive: false });
    this.root.addEventListener('touchmove', this.onMove, { passive: false });
    this.root.addEventListener('touchend', this.onEnd, { passive: false });
    this.root.addEventListener('touchcancel', this.onEnd, { passive: false });
  }

  /** Show only while actually playing; releasing all inputs on hide avoids a
   *  key sticking down when the match pauses mid-move. */
  setVisible(v: boolean) {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  /** Show or hide the Cash-Raid-only interact + buy buttons. */
  setCashRaid(on: boolean) {
    this.interactBtn.classList.toggle('hidden', !on);
    this.buyBtn.classList.toggle('hidden', !on);
  }

  // -------------------------------------------------------------------------

  private addButton(
    cls: string, label: string, set: (down: boolean) => void,
    container: HTMLElement = this.root,
  ): HTMLDivElement {
    const b = document.createElement('div');
    b.className = `tc-btn ${cls}`;
    b.textContent = label;
    const down = (e: TouchEvent) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('active'); set(true);
    };
    const up = (e: TouchEvent) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.remove('active'); set(false);
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    container.appendChild(b);
    return b;
  }

  private onStart = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if ((t.target as HTMLElement).closest('.tc-btn')) continue;
      const leftHalf = t.clientX < window.innerWidth * 0.5;
      if (leftHalf && this.moveId === null) {
        this.moveId = t.identifier;
        this.moveBaseX = t.clientX;
        this.moveBaseY = t.clientY;
        this.showStick(t.clientX, t.clientY);
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookX = t.clientX;
        this.lookY = t.clientY;
      }
    }
    e.preventDefault();
  };

  private onMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        this.updateStick(t.clientX, t.clientY);
      } else if (t.identifier === this.lookId) {
        this.input.addLook(
          (t.clientX - this.lookX) * LOOK_SCALE,
          (t.clientY - this.lookY) * LOOK_SCALE,
        );
        this.lookX = t.clientX;
        this.lookY = t.clientY;
      }
    }
    e.preventDefault();
  };

  private onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        this.moveId = null;
        this.hideStick();
        this.clearMove();
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  };

  private showStick(x: number, y: number) {
    this.stick.style.left = `${x}px`;
    this.stick.style.top = `${y}px`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('hidden');
  }

  private hideStick() {
    this.stick.classList.add('hidden');
  }

  private updateStick(x: number, y: number) {
    const dx = x - this.moveBaseX;
    const dy = y - this.moveBaseY;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, STICK_RADIUS);
    this.knob.style.transform =
      `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
    // 8-way digital mapping (the engine's wishDir is normalised anyway)
    const ux = dx / STICK_RADIUS;
    const uy = dy / STICK_RADIUS;
    this.input.setKey('KeyW', uy < -STICK_DEADZONE);
    this.input.setKey('KeyS', uy > STICK_DEADZONE);
    this.input.setKey('KeyD', ux > STICK_DEADZONE);
    this.input.setKey('KeyA', ux < -STICK_DEADZONE);
  }

  private clearMove() {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) this.input.setKey(c, false);
  }

  private releaseAll() {
    this.moveId = null;
    this.lookId = null;
    this.hideStick();
    for (const c of [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Dodge', 'KeyE', 'KeyB', 'Tab',
      'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
    ]) this.input.setKey(c, false);
    this.input.setMouse(0, false);
    this.input.setMouse(2, false);
    this.root.querySelectorAll('.tc-btn.active').forEach((b) => b.classList.remove('active'));
  }
}
