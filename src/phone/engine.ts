import type { FlagReader } from '../core/condition';
import type { Contact, MsgBody, Reply, ScriptMsg } from './format';

/**
 * The phone's state machine, no DOM: which beats have come due, the messages delivered so far (with a typing
 * pause before each of theirs), unread counts, the replies you can pick, and the phone's clock. PhoneUI
 * (ui.ts) draws it; the tests drive it. update(dt) runs every frame with the game's time step.
 */

export interface Flags {
  get: FlagReader;
  set(key: string, value: boolean): void;
}

export interface Msg {
  readonly from: 'them' | 'me';
  readonly body: MsgBody;
  /** Minutes since midnight on the phone's clock when it arrived. */
  readonly at: number;
  /** Yours: read by them (既読) once they answer or a moment after. */
  seen: boolean;
}

export type PhoneEvent = { readonly kind: 'message'; readonly contact: Contact; readonly msg: Msg } | { readonly kind: 'contact'; readonly contact: Contact };

/** idle -> armed (its condition held) -> running (their messages) -> awaiting (your reply) -> replied (their answer) -> done. */
type BeatState = { phase: 'idle' } | { phase: 'armed'; at: number } | { phase: 'running' } | { phase: 'awaiting' } | { phase: 'replied' } | { phase: 'done' };

interface Thread {
  readonly contact: Contact;
  readonly beats: BeatState[];
  readonly msgs: Msg[];
  /** Messages still to arrive: each after its pause (seconds), in order. */
  readonly queue: { msg: ScriptMsg; wait: number }[];
  /** The beat being played (its `set` applies when the queue empties and it has no replies left). */
  current: number | null;
  unread: number;
  shown: boolean;
}

/** How long they type before a message arrives (seconds). */
export function typingTime(m: ScriptMsg): number {
  if (m.from === 'me') return 0.5;
  switch (m.body.kind) {
    case 'text':
      return 1.1 + Math.min(4, m.body.text.length * 0.035);
    case 'sticker':
      return 0.9;
    case 'photo':
      return 2.2;
    case 'video':
      return 3.0;
  }
}

/** The phone's clock at the start, by the story's time of day (minutes since midnight). */
export function startClock(time: unknown): number {
  const h: Record<string, number> = { night: 23 * 60 + 36, dusk: 18 * 60 + 42, dawn: 5 * 60 + 12, day: 13 * 60 + 20 };
  return h[String(time)] ?? h.night;
}

export class Phone {
  private readonly threads: Thread[];
  private t = 0;
  /** Minutes since midnight. */
  clock: number;

  constructor(
    contacts: readonly Contact[],
    private readonly flags: Flags,
    clock = startClock(flags.get('world.time')),
  ) {
    this.clock = clock;
    this.threads = contacts.map((c) => ({ contact: c, beats: c.beats.map(() => ({ phase: 'idle' as const })), msgs: [], queue: [], current: null, unread: 0, shown: false }));
  }

  /** Advance by dt seconds: arm beats whose conditions now hold, start due ones, deliver typed messages. */
  update(dt: number): PhoneEvent[] {
    this.t += dt;
    this.clock = (this.clock + dt / 60) % (24 * 60);
    const out: PhoneEvent[] = [];
    for (const th of this.threads) {
      th.contact.beats.forEach((b, i) => {
        if (th.beats[i].phase === 'idle' && (b.when === null || b.when(this.flags.get))) th.beats[i] = { phase: 'armed', at: this.t + b.after };
      });
      // Deliver what's been typed.
      while (th.queue.length && (th.queue[0].wait -= dt) <= 0) {
        const { msg } = th.queue.shift()!;
        const m: Msg = { from: msg.from, body: msg.body, at: this.clock, seen: false };
        if (m.from === 'them') for (const x of th.msgs) if (x.from === 'me') x.seen = true;
        th.msgs.push(m);
        if (m.from === 'them') th.unread++;
        this.reveal(th, out);
        out.push({ kind: 'message', contact: th.contact, msg: m });
        dt = 0;
      }
      if (th.current !== null && th.queue.length === 0) this.finishRunning(th);
      // Start the next due beat, if the thread's free.
      if (th.current === null) {
        const i = th.beats.findIndex((s) => s.phase === 'armed' && s.at <= this.t);
        const blocked = th.beats.some((s) => s.phase === 'awaiting');
        if (i >= 0 && !blocked) this.start(th, i, out);
      }
    }
    return out;
  }

  private reveal(th: Thread, out: PhoneEvent[]): void {
    if (th.shown) return;
    th.shown = true;
    out.push({ kind: 'contact', contact: th.contact });
  }

  private start(th: Thread, i: number, out: PhoneEvent[]): void {
    const b = th.contact.beats[i];
    th.current = i;
    th.beats[i] = { phase: 'running' };
    for (const m of b.messages) th.queue.push({ msg: m, wait: typingTime(m) });
    if (b.messages.length === 0) this.reveal(th, out);
    if (th.queue.length === 0) this.finishRunning(th);
  }

  /** The beat's messages are all out: wait for your reply, or it's done. */
  private finishRunning(th: Thread): void {
    const i = th.current!;
    const phase = th.beats[i].phase;
    if (phase === 'awaiting') return;
    if (phase === 'running' && th.contact.beats[i].replies.length) th.beats[i] = { phase: 'awaiting' };
    else this.complete(th);
  }

  private apply(set: Readonly<Record<string, boolean>>): void {
    for (const [k, v] of Object.entries(set)) this.flags.set(k, v);
  }

  private thread(id: string): Thread {
    const th = this.threads.find((x) => x.contact.id === id);
    if (!th) throw new Error(`no contact ${id}`);
    return th;
  }

  /** Contacts you have a conversation with, the most recent first. */
  contacts(): Contact[] {
    const last = (th: Thread): number => (th.msgs.length ? this.threads.indexOf(th) * 1e-6 + th.msgs.length + th.msgs[th.msgs.length - 1].at * 1000 : -1);
    return this.threads.filter((th) => th.shown).sort((a, b) => last(b) - last(a)).map((th) => th.contact);
  }

  messages(id: string): readonly Msg[] {
    return this.thread(id).msgs;
  }

  /** They're typing (a message of theirs is on its way). */
  typing(id: string): boolean {
    const q = this.thread(id).queue;
    return q.length > 0 && q[0].msg.from === 'them';
  }

  /** The replies you can pick now, or none. */
  replies(id: string): readonly Reply[] {
    const th = this.thread(id);
    if (th.current === null || th.beats[th.current].phase !== 'awaiting') return [];
    return th.contact.beats[th.current].replies;
  }

  /** Send reply i: your message, its flags, then their answer and the beat's own flags. */
  reply(id: string, i: number): boolean {
    const th = this.thread(id);
    const r = this.replies(id)[i];
    if (!r) return false;
    th.msgs.push({ from: 'me', body: { kind: 'text', text: r.text }, at: this.clock, seen: false });
    this.apply(r.set);
    for (const m of r.then) th.queue.push({ msg: m, wait: typingTime(m) });
    th.beats[th.current!] = { phase: 'replied' };
    if (th.queue.length === 0) this.complete(th);
    return true;
  }

  private complete(th: Thread): void {
    const b = th.contact.beats[th.current!];
    this.apply(b.set);
    th.beats[th.current!] = { phase: 'done' };
    th.current = null;
  }

  markRead(id: string): void {
    this.thread(id).unread = 0;
  }

  unread(id: string): number {
    return this.thread(id).unread;
  }

  get totalUnread(): number {
    return this.threads.reduce((n, th) => n + th.unread, 0);
  }

  /** Waiting on you: a thread with replies to pick. */
  get awaiting(): number {
    return this.threads.filter((th) => this.replies(th.contact.id).length > 0).length;
  }

  /** hh:mm on the phone's clock. */
  static time(minutes: number): string {
    const m = Math.floor(minutes) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}
