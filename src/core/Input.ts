// Keyboard + pointer-lock mouse. Mouse deltas accumulate between frames and are consumed once.

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDown = false;
  private mdx = 0;
  private mdy = 0;

  constructor(private target: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = false;
    });
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.locked) this.mouseDown = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mdx += e.movementX;
      this.mdy += e.movementY;
    });
  }

  get locked() {
    return document.pointerLockElement === this.target;
  }

  lock() {
    // Some browsers return a promise that rejects if called too soon after an exit.
    const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  /** True only on the first frame a key goes down. */
  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  consumeMouse(): { dx: number; dy: number } {
    const d = { dx: this.mdx, dy: this.mdy };
    this.mdx = this.mdy = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }
}
