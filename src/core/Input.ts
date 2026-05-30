/**
 * Keyboard + mouse input with pointer-lock management.
 *
 * Movement/aim is polled every frame; fire/jump/weapon-switch are read as
 * either held state or one-shot "pressed this frame" edges.
 */
export class Input {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mouseButtons = new Set<number>();
  private mousePressedThisFrame = new Set<number>();

  /** Accumulated mouse delta since last frame() call. */
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;

  locked = false;
  /** Called when pointer lock is lost unexpectedly (used to auto-pause). */
  onPointerUnlock: (() => void) | null = null;

  /** Touch mode: there is no Pointer Lock API on phones, so lock is faked and
   *  movement / aim / buttons are fed by `TouchControls` via the setters below. */
  touch = false;

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    // right-click is alt-fire — suppress the browser context menu
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    // Releasing all keys when the tab loses focus avoids "stuck" movement.
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestLock() {
    if (this.touch) { this.locked = true; return; }
    this.el.requestPointerLock();
  }

  exitLock() {
    if (this.touch) { this.locked = false; return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- virtual input (driven by TouchControls) ----------------------------

  /** Set a key as held/released, recording the press edge like a real key. */
  setKey(code: string, down: boolean) {
    if (down) {
      if (!this.keys.has(code)) this.pressedThisFrame.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** Set a mouse button as held/released (0 = fire, 2 = alt-fire). */
  setMouse(btn: number, down: boolean) {
    if (down) {
      if (!this.mouseButtons.has(btn)) this.mousePressedThisFrame.add(btn);
      this.mouseButtons.add(btn);
    } else {
      this.mouseButtons.delete(btn);
    }
  }

  /** Feed an aim delta (touch-look), consumed like accumulated mouse motion. */
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  private onLockChange = () => {
    const nowLocked = document.pointerLockElement === this.el;
    if (this.locked && !nowLocked) this.onPointerUnlock?.();
    this.locked = nowLocked;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
    this.keys.add(e.code);
    // Stop the browser stealing common game keys.
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onMouseDown = (e: MouseEvent) => {
    if (!this.mouseButtons.has(e.button)) this.mousePressedThisFrame.add(e.button);
    this.mouseButtons.add(e.button);
  };
  private onMouseUp = (e: MouseEvent) => this.mouseButtons.delete(e.button);

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private onWheel = (e: WheelEvent) => {
    this.wheelDelta += Math.sign(e.deltaY);
  };

  key(code: string): boolean { return this.keys.has(code); }
  keyPressed(code: string): boolean { return this.pressedThisFrame.has(code); }
  mouse(btn: number): boolean { return this.mouseButtons.has(btn); }
  mousePressed(btn: number): boolean { return this.mousePressedThisFrame.has(btn); }

  /** Call once at the end of every frame to clear per-frame edge state. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.mousePressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
