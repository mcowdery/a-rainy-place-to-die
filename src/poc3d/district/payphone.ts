import * as THREE from 'three';
import { PAYPHONE_KEYS } from '../models/payphone';
import type { PayphoneField } from '../real/payphoneField';

/**
 * Using a payphone (docs/street-furniture-plan.md, step 5). E at the phone you're standing at (the field's engaged
 * one) picks up the handset for ¥10: you stop walking (you can still look about), hear the dial tone, and dial on
 * the number keys. A push-button phone's keys go in and sound their tones; the red and pink phones have a dial,
 * which winds round and clicks back, a digit at a time. A number that is somebody's rings, is answered, and its
 * lines are shown one after another; any other gets the recorded apology and the engaged tone. E hangs up. A
 * booth's door swings open as you come up to it and shuts behind you when you've gone.
 *
 * Who answers is `lines`: the caller's own table (the page's: the speaking clock, the weather, a taxi). Story calls
 * will be conversations played here; none yet.
 *
 * **Not acted**: his hand doesn't reach for the handset. It lifts off its hooks and is put out of sight while he's on
 * the line (at his ear, where first person can't see it); from outside it simply goes. That move wants its own
 * review (mack.md: moves are shown before they're wired).
 */
export interface PhoneAnswer {
  /** What you hear, a line at a time. */
  readonly lines: readonly string[];
  /** Once the last line has been said. */
  readonly then?: () => void;
}

export interface PayphoneHooks {
  readonly audio: {
    phoneTone(kind: 'dial' | 'ring' | 'busy' | null): void;
    phoneKey(key: string): void;
    phonePulses(n: number): void;
    phoneHook(): void;
    phoneCoin(): void;
  };
  /** Takes the call's ¥10; false if he hasn't got it. */
  readonly pay: (yen: number) => boolean;
  /** Stops him walking while he's on the line. */
  readonly hold: (on: boolean) => void;
  /** A message at the top of the screen (no coins, and so on). */
  readonly toast: (text: string, seconds?: number) => void;
  /** Who a number reaches, or null. */
  readonly lines: (number: string) => PhoneAnswer | null;
}

const COST = 10;
/** Within this of the phone, and looking its way, E picks it up. */
const REACH = 1.9;
/** A booth's door is open while you're this near it. */
const DOOR_NEAR = 2.7;
/** How long after the last digit a known number starts to ring, and an unknown one gives up (s). */
const CONNECT = 1.1;
const GIVE_UP = 5;
const KEY_OF = '123456789*0#';

type State = 'idle' | 'dialling' | 'ringing' | 'answered' | 'dead';

export class PayphoneUse {
  private state: State = 'idle';
  private number = '';
  private sinceDigit = 0;
  private wait = 0;
  private answer: PhoneAnswer | null = null;
  private line = 0;
  /** Parts in motion: the handset off its hooks (0-1), the door (0-1), each key's press, the dial's wind, the flap. */
  private lift = 0;
  private door = 0;
  private readonly press = new Map<string, number>();
  private flap = 0;
  /** A dial's digits waiting their turn, and the one running: how far through its wind and run back. */
  private readonly queue: string[] = [];
  private dialling: { digit: string; t: number; wind: number; back: number } | null = null;
  private readonly panel: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly field: PayphoneField,
    private readonly hooks: PayphoneHooks,
  ) {
    this.hint = document.createElement('div');
    Object.assign(this.hint.style, { position: 'fixed', left: '50%', bottom: '18%', transform: 'translateX(-50%)', padding: '6px 14px', background: 'rgba(8, 8, 14, 0.72)', border: '1px solid #3a3850', borderRadius: '6px', color: '#e8e6f0', font: "13px 'Consolas', monospace", pointerEvents: 'none', display: 'none', zIndex: '20' });
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, { position: 'fixed', left: '50%', bottom: '9%', transform: 'translateX(-50%)', minWidth: '300px', maxWidth: '70vw', padding: '10px 16px', background: 'rgba(10, 8, 4, 0.86)', border: '1px solid #6a4a12', borderRadius: '6px', color: '#ffb52e', font: "14px 'Consolas', monospace", textAlign: 'center', pointerEvents: 'none', display: 'none', zIndex: '20', textShadow: '0 0 6px rgba(255, 170, 30, 0.5)' });
    document.body.append(this.hint, this.panel);
  }

  /** On the line (the handset is up). */
  get active(): boolean {
    return this.state !== 'idle';
  }

  private rotary(): boolean {
    return !!this.field.engaged?.rig.dial;
  }

  /** Whether E would pick the phone up: you're at one, close, and looking at it. */
  canUse(camera: THREE.Camera): boolean {
    const e = this.field.engaged;
    if (!e || this.active) return false;
    const dx = e.spot.x - camera.position.x;
    const dz = e.spot.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d > REACH) return false;
    camera.getWorldDirection(this.dir);
    // (Inside a booth you stand almost on its middle: anywhere you look is at the phone.)
    return d < 0.5 || (this.dir.x * dx + this.dir.z * dz) / (d || 1) > 0.35;
  }

  /** E: pick up (true if it did). */
  pickUp(camera: THREE.Camera): boolean {
    if (!this.canUse(camera)) return false;
    if (!this.hooks.pay(COST)) {
      this.hooks.toast(`A call is ¥${COST}, and he hasn't got it.`, 3);
      return true;
    }
    this.state = 'dialling';
    this.number = '';
    this.sinceDigit = 0;
    this.queue.length = 0;
    this.dialling = null;
    this.answer = null;
    this.flap = 0;
    this.hooks.hold(true);
    this.hooks.audio.phoneHook();
    this.hooks.audio.phoneCoin();
    this.hooks.audio.phoneTone('dial');
    this.show();
    return true;
  }

  hangUp(): void {
    if (!this.active) return;
    this.state = 'idle';
    this.hooks.audio.phoneTone(null);
    this.hooks.audio.phoneHook();
    this.hooks.hold(false);
    this.queue.length = 0;
    this.dialling = null;
    this.panel.style.display = 'none';
  }

  /** A key while on the line: a digit dials, E hangs up. True if it was the phone's. */
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (e.code === 'KeyE') {
      this.hangUp();
      return true;
    }
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    const digit = m ? m[1] : e.key === '*' ? '*' : e.key === '#' ? '#' : null;
    if (digit === null || e.repeat) return true;
    this.dial(digit);
    return true;
  }

  private dial(digit: string): void {
    if (this.state !== 'dialling') return;
    if (this.rotary()) {
      // A dial has no star or hash, and sends one digit at a time.
      if (digit === '*' || digit === '#') return;
      this.queue.push(digit);
      return;
    }
    this.register(digit);
    this.press.set(PAYPHONE_KEYS[KEY_OF.indexOf(digit)], 0.16);
    this.hooks.audio.phoneKey(digit);
  }

  private register(digit: string): void {
    // The dial tone stops at the first digit.
    if (!this.number) this.hooks.audio.phoneTone(null);
    this.number += digit;
    this.sinceDigit = 0;
    this.show();
  }

  private show(text?: string): void {
    this.panel.style.display = 'block';
    const number = this.number || ' ';
    const what = text ?? (this.state === 'dialling' ? (this.number ? '' : 'dial tone') : this.state === 'ringing' ? 'ringing…' : this.state === 'dead' ? 'engaged tone' : '');
    this.panel.innerHTML = '';
    const top = document.createElement('div');
    Object.assign(top.style, { fontSize: '20px', letterSpacing: '0.2em' });
    top.textContent = number;
    const mid = document.createElement('div');
    Object.assign(mid.style, { margin: '6px 0', color: '#f0e6d0', whiteSpace: 'pre-wrap', textShadow: 'none' });
    mid.textContent = what;
    const bot = document.createElement('div');
    Object.assign(bot.style, { fontSize: '11px', color: '#b87a10', textShadow: 'none' });
    bot.textContent = this.state === 'dialling' ? '0-9 dial  ·  117 the time  ·  177 the weather  ·  5100 a taxi  ·  E hang up' : 'E hang up';
    this.panel.append(top, mid, bot);
  }

  /** Per frame: the call's progress and the parts' movement. */
  update(dt: number, camera: THREE.Camera): void {
    const e = this.field.engaged;
    // Walked off, or the phone's gone: the line drops.
    if (this.active && !e) this.hangUp();
    this.hint.style.display = this.canUse(camera) ? 'block' : 'none';
    if (this.hint.style.display === 'block') this.hint.textContent = `[E] Pick up the phone  ·  ¥${COST}`;
    if (this.state === 'dialling') {
      // A dial: the digit in hand winds round to the stop and runs back, clicking, then the next.
      if (this.dialling) {
        const g = this.dialling;
        g.t += dt;
        if (g.t >= g.wind + g.back) {
          this.register(g.digit);
          this.dialling = null;
        }
      } else if (this.queue.length) {
        const digit = this.queue.shift()!;
        const n = digit === '0' ? 10 : Number(digit);
        this.dialling = { digit, t: 0, wind: 0.2 + n * 0.035, back: n * 0.1 };
        window.setTimeout(() => this.state === 'dialling' && this.hooks.audio.phonePulses(n), (0.2 + n * 0.035) * 1000);
      }
      this.sinceDigit += dt;
      const busy = this.dialling !== null || this.queue.length > 0;
      if (this.number && !busy) {
        const who = this.hooks.lines(this.number);
        if (who && this.sinceDigit > CONNECT) {
          this.answer = who;
          this.state = 'ringing';
          this.wait = 2.6 + Math.random() * 2;
          this.hooks.audio.phoneTone('ring');
          this.show();
        } else if (!who && (this.sinceDigit > GIVE_UP || this.number.length >= 10)) {
          this.state = 'dead';
          this.hooks.audio.phoneTone('busy');
          this.show('おかけになった電話番号は、現在使われておりません。\nThe number you have dialled is not in service.');
        }
      }
    } else if (this.state === 'ringing') {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.state = 'answered';
        this.line = 0;
        this.wait = 0;
        this.hooks.audio.phoneTone(null);
        this.hooks.audio.phoneHook();
      }
    } else if (this.state === 'answered' && this.answer) {
      this.wait -= dt;
      if (this.wait <= 0) {
        if (this.line < this.answer.lines.length) {
          const text = this.answer.lines[this.line++];
          this.show(text);
          // Long enough to read: a line's length sets it.
          this.wait = 2.2 + text.length * 0.045;
        } else {
          const then = this.answer.then;
          this.answer = null;
          this.state = 'dead';
          this.hooks.audio.phoneTone('busy');
          this.show('(They hang up.)');
          then?.();
        }
      }
    }
    if (!e) return;
    // The parts. The handset comes off its hooks and is then out of sight (at his ear) until he hangs up.
    const rig = e.rig;
    this.lift += ((this.active ? 1 : 0) - this.lift) * Math.min(1, dt * 9);
    rig.setHandset(Math.min(1, this.lift * 1.4));
    if (rig.handset) rig.handset.visible = this.lift < 0.8;
    for (const [name, t] of this.press) {
      const left = t - dt;
      rig.setKey(name, left > 0 ? Math.sin((left / 0.16) * Math.PI) : 0);
      if (left > 0) this.press.set(name, left);
      else this.press.delete(name);
    }
    if (rig.dial) {
      const g = this.dialling;
      const n = g ? (g.digit === '0' ? 10 : Number(g.digit)) / 10 : 0;
      rig.setDial(g ? (g.t < g.wind ? (g.t / g.wind) * n : Math.max(0, 1 - (g.t - g.wind) / g.back) * n) : 0);
    }
    this.flap = Math.max(0, this.flap - dt * 2);
    rig.setFlap(this.flap);
    // A booth's door: open as you come up to it, and while you're in it.
    if (rig.door) {
      const near = Math.hypot(e.spot.x - camera.position.x, e.spot.z - camera.position.z) < DOOR_NEAR;
      this.door += ((near ? 1 : 0) - this.door) * Math.min(1, dt * 4);
      rig.setDoor(this.door);
    }
  }
}
