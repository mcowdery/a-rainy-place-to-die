import type { Prop } from '../real/props';
import type { StandingPerson } from '../real/crowd';
import type { Inspectable, Line } from './investigate';

/**
 * What Mack has a word for as he goes about: the city's props to look at and (close up) touch, and the people
 * standing about to look at and (close up) talk to. The words are the object's own, kept here by kind so every
 * lamp, vending machine and passer-by is something he can remark on without a placement each; a story object with
 * its own lines is added to the investigator directly (`Investigator.add`).
 *
 * Mack is dry, tired, observant, a stranger here. No real brands, no names.
 */

/** What the lines may ask about the moment. */
export interface Moment {
  rain(): boolean;
  night(): boolean;
}
let M: Moment = { rain: () => false, night: () => false };
const rain = (text: string): Line => ({ text, when: () => M.rain() });
const night = (text: string): Line => ({ text, when: () => M.night() });

interface PropWords {
  /** The reticule's caption on the eye. */
  readonly label: string;
  /** Height of the point he looks at, and how big it looks (m). */
  readonly h: number;
  readonly r: number;
  readonly look: readonly Line[];
  /** The hand: its caption, how near, and what happens. */
  readonly use?: { readonly label: string; readonly lines: readonly Line[]; readonly range?: number };
}

const SPECIES: Record<string, readonly Line[]> = {
  ginkgo: ['Ginkgo. They say it outlives everything, wars included.', 'The ginkgo has been here longer than the street.'],
  zelkova: ['Zelkova. Someone planted these on purpose, back when the city still planned.', 'A zelkova, trying to reach the sky past all this concrete.'],
  sakura: ['Cherry. Nobody looks at it until it flowers, then everyone does.', 'A cherry tree. Pretty for a week, and that is the whole deal.'],
  pine: ['A black pine, clipped into shape like everything else around here.', 'The pine has the posture of a man who has been told to stand up straight for forty years.'],
  camphor: ['Camphor. Smells like a medicine cabinet when you crush a leaf.', 'A camphor, big and patient.'],
  dogwood: ['Dogwood. The flowers look like paper.'],
  azalea: ['Azaleas, clipped to a pillow.'],
  box: ['Boxwood, trimmed to within an inch of its life.'],
};

const PROPS: Record<string, PropWords> = {
  lamp: {
    label: 'street lamp',
    h: 5,
    r: 1,
    look: ['A street lamp, one in a long line of them.', 'Sodium light. Makes everyone look like they have something to hide.', rain('Rain slants through the lamplight like static.'), night('The lamps hum. Every pool of light is somebody’s whole evening.')],
    use: { label: 'Touch', lines: ['Cold metal, a bit slick.', 'Solid. Somebody bolted this down properly.'], range: 2.2 },
  },
  pole: {
    label: 'utility pole',
    h: 4,
    r: 1,
    look: ['Wires everywhere. The city keeps its nerves on the outside.', 'A utility pole, a dozen cables going who knows where.', 'Every pole has a laminated notice about something stuck to it.'],
    use: { label: 'Touch', lines: ['Concrete, rough, still holding the day’s damp.', 'Somebody has stuck a flyer here and someone else tore it half off.'], range: 2.2 },
  },
  vending: {
    label: 'vending machine',
    h: 1,
    r: 0.8,
    look: ['A vending machine, glowing like a small shrine. Can’t go ten steps in this city without one.', 'Hot and cold drinks, all in one. Somebody keeps it stocked at all hours.', night('The only thing in this city that’s always open.'), rain('Warm light in the wet. Tempting.')],
    use: { label: 'Use', lines: ['Hot canned coffee, two hundred yen. It lands with a clunk and warms his palm.', 'A can of something cold. He drinks it standing there.', 'Coins in, a rattle, a can. Simple. He wishes everything was.'], range: 2.2 },
  },
  tree: {
    label: 'tree',
    h: 3,
    r: 1.4,
    look: ['A tree in a city of concrete. Somebody had a sense of humour.'],
    use: { label: 'Touch', lines: ['The bark is damp and rough under his hand.', 'It doesn’t care that he’s here. That’s restful.'], range: 2.4 },
  },
  hedge: { label: 'hedge', h: 0.8, r: 1, look: ['A hedge cut dead level with a ruler.', 'Somebody trims this every week. Nobody thanks them.'], use: { label: 'Touch', lines: ['Wet leaves, springy under his palm.'], range: 2 } },
  pots: { label: 'plant pots', h: 0.5, r: 0.7, look: ['Potted plants lined up along the shopfront. The neighbourhood’s pride.', 'Somebody waters these every morning. Care in a city that doesn’t advertise it.'], use: { label: 'Touch', lines: ['The soil is damp. Somebody does look after them.'], range: 2 } },
  planter: { label: 'planter', h: 0.6, r: 0.8, look: ['A planter with something green and stubborn in it.'], use: { label: 'Touch', lines: ['Cool stone, a leaf springing back.'], range: 2 } },
  bench: {
    label: 'bench',
    h: 0.6,
    r: 1,
    look: ['A bench, worn smooth. Plenty of people have sat here thinking about leaving.', 'A bench. Good place to watch the street.'],
    use: { label: 'Touch', lines: ['Cold slats. He’d sit, but there’s somewhere to be.', rain('Wet. He decides standing is fine.')], range: 2.2 },
  },
  postlamp: { label: 'lamp', h: 3, r: 0.8, look: ['A park lamp, soft light for people with nowhere to be.'], use: { label: 'Touch', lines: ['Smooth iron.'], range: 2 } },
  fence: { label: 'fence', h: 1.2, r: 1.2, look: ['A fence. Keeps somebody’s things in, or somebody out.'], use: { label: 'Touch', lines: ['Cold wire. He wraps his fingers through it and looks past.'], range: 2 } },
  paymachine: {
    label: 'pay machine',
    h: 1.2,
    r: 0.7,
    look: ['A coin parking machine. The rates are insulting.', 'A pay machine with a light on it that’s been blinking for years.'],
    use: { label: 'Use', lines: ['He doesn’t have a car here to pay for. Probably.', 'The display says the price for an hour. He lets it be.'], range: 2 },
  },
  psign: { label: 'sign', h: 2.2, r: 0.8, look: ['A parking sign, numbers and kanji, a rule only locals know.'] },
  wheelstop: { label: 'wheel stop', h: 0.2, r: 0.5, look: ['A concrete wheel stop, chipped by years of nervous drivers.'] },
  swing: {
    label: 'swing',
    h: 1,
    r: 1,
    look: ['A swing in an empty playground. Kids here probably play on their phones.', 'A swing, rocking slightly. Nobody’s on it.'],
    use: { label: 'Push', lines: ['He gives it a push. It creaks, swings, comes back.', 'The chain squeaks the whole way back.'], range: 2.4 },
  },
  slide: { label: 'slide', h: 1.2, r: 1.2, look: ['A slide, polished by a hundred small afternoons.'], use: { label: 'Touch', lines: ['Cold steel, worn smooth.'], range: 2.4 } },
  sandbox: { label: 'sandbox', h: 0.2, r: 1.2, look: ['A sandbox. A forgotten plastic shovel. A whole life, abandoned mid-dig.'], use: { label: 'Touch', lines: ['Damp sand. It holds the print of his fingers.'], range: 2.4 } },
  toilet: { label: 'public toilet', h: 1.4, r: 1.5, look: ['A public toilet. The city is cleaner than it ought to be.', 'Public toilets, spotless. Somebody cleans these before dawn.'] },
  weeds: { label: 'weeds', h: 0.3, r: 0.8, look: ['Weeds pushing through the cracks. The city can’t get rid of them.', 'Nature taking a slow, patient revenge.'] },
  board: { label: 'notice board', h: 1.4, r: 1, look: ['A notice board. Lost cats, neighbourhood meetings, a festival nobody remembers organising.'], use: { label: 'Read', lines: ['A flyer for a lost cat. The reward has been crossed out and raised twice.', 'A cleanup rota. Somebody signed Tuesday and then never turned up.'], range: 2.4 } },
  cones: { label: 'traffic cones', h: 0.4, r: 0.7, look: ['Cones. Road work, or somebody’s idea of a joke.'], use: { label: 'Touch', lines: ['Plastic, slightly sticky.'], range: 2 } },
  bike: {
    label: 'bicycle',
    h: 0.8,
    r: 0.7,
    look: ['A bicycle left where it fell, or where it was parked. Hard to say here.', 'A bicycle with a basket and a bell. Nobody steals those in this town.'],
    use: { label: 'Touch', lines: ['He flicks the bell. A thin ring, and a shop assistant glances out.', rain('Wet saddle. He keeps his hand off it.')], range: 2 },
  },
  container: { label: 'container', h: 3, r: 3, look: ['Shipping containers stacked high. Stuff from everywhere, going nowhere in particular.', 'Rust and stencilled numbers. Whatever’s inside paid for its trip.'], use: { label: 'Touch', lines: ['Cold corrugated steel, beaded with moisture.'], range: 3 } },
  signal: { label: 'traffic signal', h: 5.5, r: 1, look: ['A signal on its arm over the road. The city runs on that little light.', 'Red, green, red. The only reliable sequence in town.'], use: { label: 'Touch', lines: ['A crossing button, worn pale in the middle. He presses it. Nothing visible happens.'], range: 2.2 } },
  car: {
    label: 'parked car',
    h: 0.9,
    r: 1.7,
    look: ['A parked car. Somebody left this and went to dinner. Or didn’t.', 'Beaded with water. Quiet. Could be anyone’s.', 'A car with a dashboard full of someone else’s life.'],
    use: { label: 'Peer in', lines: ['A tissue box on the shelf, a charm hanging from the mirror. Nobody home.', 'He cups his hand to the glass. Empty seats, a folded newspaper.', 'Locked, of course.'], range: 2.6 },
  },
};

const hash = (x: number, z: number): number => Math.abs((Math.round(x * 7.31) * 73856093) ^ (Math.round(z * 7.31) * 19349663));
const rotate = <T,>(xs: readonly T[], n: number): T[] => (xs.length ? [...xs.slice(n % xs.length), ...xs.slice(0, n % xs.length)] : []);

/** The props that have a word, as Inspectables (stable per place, so a look can settle). */
export class PropLookables {
  private readonly made = new Map<string, Inspectable>();

  constructor(moment: Moment) {
    M = moment;
  }

  of(props: readonly Prop[], ground: (x: number, z: number) => number): Inspectable[] {
    const out: Inspectable[] = [];
    for (const p of props) {
      const w = PROPS[p.kind];
      if (!w) continue;
      const id = `prop:${p.kind}:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`;
      let it = this.made.get(id);
      if (!it) {
        const h = hash(p.x, p.z);
        const size = Math.max(w.r, p.radius + (p.half ?? 0) * 0.6, p.kind === 'tree' ? (p.size ?? 1) * 1.4 : 0);
        const base = p.kind === 'tree' && p.species && SPECIES[p.species] ? [...SPECIES[p.species], ...w.look] : w.look;
        const y = ground(p.x, p.z) + 0.15 + w.h * (p.kind === 'tree' ? Math.max(0.8, p.size ?? 1) : 1);
        it = {
          id,
          radius: size,
          label: w.label,
          range: 38,
          lines: rotate(base, h),
          interact: w.use && { label: w.use.label, lines: rotate(w.use.lines, h >> 3), range: w.use.range },
          at: (o) => o.set(p.x, y, p.z),
        };
        this.made.set(id, it);
        if (this.made.size > 4000) this.made.delete(this.made.keys().next().value!);
      }
      out.push(it);
    }
    return out;
  }
}

const PEOPLE_LOOK: Record<string, readonly Line[]> = {
  phone: ['Head down, thumbs going. Everyone’s somewhere else.', 'Someone lost in the glow of a phone. They’d walk into traffic.'],
  talk: ['Two voices low, then high, then low again. A story in installments.', 'Deep in conversation. Not for him.'],
  pockets: ['Hands in pockets, waiting for something. Aren’t we all.', 'Standing like a man who’s decided not to decide.'],
  wave: ['Someone waving at someone. Good for them.'],
  stand: ['Someone standing by themselves, watching the street the way he does.', 'A person waiting. Always someone waiting.'],
  hold: ['Hand in hand. Nothing complicated about it.'],
};
const MANNER_LOOK: Record<string, readonly Line[]> = {
  shady: ['That one’s trying hard not to be noticed. Which is how you notice.', 'Standing too still, eyes working the street. Not waiting for a friend.', 'He knows I’m looking. He looks anyway.'],
  drunk: ['A man having a long night and not wanting it to end.', 'Swaying gently. Tomorrow’s problem.'],
  formal: ['A person dressed for work, wearing the day on their shoulders.', 'Pressed and tired. Salary, all the way down.'],
  young: ['Young. Still believes the night is theirs.', 'Dressed for a fight nobody’s starting.'],
};
const BODY_LOOK: Record<string, readonly Line[]> = {
  child: ['A kid. Small, serious, out when they shouldn’t be.'],
  elder: ['An old one, who has watched this place change too many times to be impressed.', 'An elder, who looks like they know every story on this block.'],
};

const TALK_BY_MANNER: Record<string, readonly Line[]> = {
  shady: [
    { who: 'Stranger', text: 'You lost? Keep walking.' },
    { who: 'Stranger', text: 'I don’t know you. I don’t want to.' },
    { who: 'Stranger', text: 'Nothing to see here. Move along.' },
  ],
  drunk: [
    { who: 'Drunk', text: 'Heyyy... have you seen my... my friend? He was here. Tall...' },
    { who: 'Drunk', text: 'One more. Just one. You’re buying, right?' },
    { who: 'Drunk', text: 'The ground keeps moving. Have you noticed that?' },
  ],
  formal: [
    { who: 'Office worker', text: 'Sorry, I’m late. Excuse me.' },
    { who: 'Office worker', text: 'The last train is soon. I can’t talk.' },
  ],
  young: [
    { who: 'Kid', text: 'What? You want something?' },
    { who: 'Kid', text: 'Uncle, you look like a cop. Are you a cop?' },
  ],
};
const TALK_BY_POSE: Record<string, readonly Line[]> = {
  phone: [
    { who: 'Passer-by', text: '...Hm? Sorry, I’m on a call.' },
    { who: 'Passer-by', text: 'One second—what? No, not you. Sorry.' },
  ],
  talk: [
    { who: 'Passer-by', text: 'Sorry, we’re in the middle of something.' },
    { who: 'Passer-by', text: 'Can it wait?' },
  ],
  pockets: [
    { who: 'Passer-by', text: 'Waiting for someone. Not you, I think.' },
    { who: 'Passer-by', text: 'Nice night, if you like rain.' },
  ],
  stand: [
    { who: 'Passer-by', text: 'Yes? Oh. Sorry, I thought you were someone else.' },
    { who: 'Passer-by', text: 'The station? That way. Keep walking.' },
  ],
};
const TALK_BY_BODY: Record<string, readonly Line[]> = {
  child: [
    { who: 'Child', text: 'Mama says not to talk to strangers.' },
    { who: 'Child', text: 'Are you a foreigner?' },
  ],
  elder: [
    { who: 'Old person', text: 'This street was quieter when I was young. Everything was.' },
    { who: 'Old person', text: 'You’re not from here. That’s all right. Nobody is, anymore.' },
  ],
};
const GENERIC_TALK: readonly Line[] = [{ who: 'Passer-by', text: 'Hm? Sorry.' }, { who: 'Passer-by', text: 'I’m sorry, I don’t know.' }];

/** Words for someone standing about: what he sees, and what they say when he speaks. */
export class PeopleLookables {
  private readonly made = new Map<string, Inspectable>();

  constructor(moment: Moment) {
    M = moment;
  }

  of(people: readonly StandingPerson[]): Inspectable[] {
    const out: Inspectable[] = [];
    for (const p of people) {
      const id = `person:${p.id}`;
      let it = this.made.get(id);
      if (!it) {
        const h = Math.abs(Math.floor(p.seed * 997));
        const look = rotate([...(MANNER_LOOK[p.manner] ?? []), ...(BODY_LOOK[p.body] ?? []), ...(PEOPLE_LOOK[p.pose] ?? PEOPLE_LOOK.stand), rain('Rain gets into everything, even a conversation.')], h);
        const talk = rotate([...(TALK_BY_MANNER[p.manner] ?? []), ...(TALK_BY_BODY[p.body] ?? []), ...(TALK_BY_POSE[p.pose] ?? []), ...GENERIC_TALK], h >> 2);
        const hy = p.y + (p.body === 'child' ? 0.75 : 1.1);
        it = {
          id,
          radius: 0.55,
          label: p.manner === 'shady' ? 'suspicious' : 'person',
          range: 30,
          lines: look,
          interact: { label: 'Talk', lines: talk, range: 2.6 },
          at: (o) => o.set(p.x, hy, p.z),
        };
        this.made.set(id, it);
        if (this.made.size > 2000) this.made.delete(this.made.keys().next().value!);
      }
      out.push(it);
    }
    return out;
  }
}
