// Gamepad support (standard mapping: Xbox / PlayStation / Steam Deck).
// Polled once per frame; exposes analog sticks, triggers and button edges, plus rumble helpers.
//
//  LS move · RS look · RT fire · LT aim (knife: heavy) · A jump · B crouch · X reload / use (contextual)
//  Y swap primary/secondary · LB knife · RB grenade (hold to cook) · L3 sprint · R3 inspect
//  D-pad up flashlight · D-pad down fire mode · D-pad left/right lean · View (hold) scores · Menu pause
const DEAD = 0.16;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export class Pad {
  constructor() {
    this.index = -1;
    this.active = false;
    this.lx = 0; this.ly = 0; this.rx = 0; this.ry = 0; this.lt = 0; this.rt = 0;
    this.down = new Array(17).fill(false);
    this.prev = new Array(17).fill(false);
    window.addEventListener('gamepadconnected', (e) => { if (this.index < 0) this.index = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.index === this.index) { this.index = -1; this.active = false; } });
  }
  get gp() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.index >= 0 && list[this.index]) return list[this.index];
    for (const g of list) if (g && g.connected) { this.index = g.index; return g; }
    return null;
  }
  poll() {
    this.prev = this.down.slice();
    const g = this.gp;
    if (!g) { this.down.fill(false); this.lx = this.ly = this.rx = this.ry = this.lt = this.rt = 0; return false; }
    const a = g.axes;
    this.lx = dz(a[0] || 0); this.ly = dz(a[1] || 0); this.rx = dz(a[2] || 0); this.ry = dz(a[3] || 0);
    const b = g.buttons, val = (i) => (b[i] ? (typeof b[i] === 'object' ? b[i].value : b[i]) : 0), pr = (i) => !!(b[i] && (b[i].pressed || val(i) > 0.5));
    this.lt = val(6); this.rt = val(7);
    for (let i = 0; i < 17; i++) this.down[i] = pr(i);
    const any = this.down.some(Boolean) || this.lx || this.ly || this.rx || this.ry;
    if (any) this.active = true;
    return this.active;
  }
  pressed(i) { return this.down[i] && !this.prev[i]; }
  released(i) { return !this.down[i] && this.prev[i]; }
  rumble(strong, weak, ms) {
    const g = this.gp;
    if (!g || !this.active || !g.vibrationActuator) return;
    try { g.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* unsupported */ }
  }
}
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
