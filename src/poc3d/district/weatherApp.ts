import type { Weather } from '../../atmosphere/rules';
import type { PhoneApp } from '../../phone/ui';
import { DAY, hhmm, SYNODIC, WEEKDAYS, WEEKDAYS_EN, weekdayOf, type DayLight, type MoonNow } from './clock';
import { airWith, type Outlook } from './forecast';

/**
 * 天気 Tenki, the phone's weather app (an invented one, no real brands): the forecast (district/forecast.ts) for
 * Tōto. Now (the weather as it is, the temperature, the rainy season or a heat wave with its heatstroke warning),
 * the next 24 hours by the hour (sky, temperature, rain), and the next five days (the sky through the day, high and
 * low, the chance of rain), and the sun and the moon (sunrise and sunset by the season, tonight's moon on the lunar
 * calendar: its phase and its old name, its age, when it rises and sets; at night the sky's icon is the moon's phase
 * while it's up). The forecast is the weather to come, so it's right, unless the story holds the weather.
 */
export interface WeatherSource {
  /** Minutes since the story began. */
  now(): number;
  /** The forecast at a minute. */
  at(total: number): Outlook;
  /** The weather as it is now (held weather can differ from the forecast), and how hard it rains. */
  current(): { weather: Weather; amount: number };
  /** 春 spring ... */
  season(): string;
  /** The moon at a minute (clock.ts moonAt). */
  moon(total: number): MoonNow;
  /** The season's sunrise and sunset. */
  daylight(): DayLight;
}

/** The phase's symbol (northern sky: a waxing moon lit on the right). */
const PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const phaseIcon = (age: number): string => PHASES[Math.round((age / SYNODIC) * 8) % 8];
/** The moon's old names by its age in days, with an English gloss. */
function moonName(age: number): [string, string] {
  if (age < 1.5 || age >= 28) return ['新月', 'New moon'];
  if (age < 5.5) return ['三日月', 'Crescent'];
  if (age < 9.4) return ['上弦の月', 'First quarter'];
  if (age < 13.3) return ['十三夜', 'Waxing gibbous'];
  if (age < 15.3) return ['満月', 'Full moon'];
  if (age < 16.5) return ['十六夜', 'Izayoi, the night after'];
  if (age < 20.4) return ['寝待月', 'Waning gibbous'];
  if (age < 24.4) return ['下弦の月', 'Last quarter'];
  return ['有明月', 'Waning crescent'];
}

const LABEL: Record<string, [string, string]> = {
  clear: ['晴れ', 'Clear'],
  night: ['晴れ', 'Clear night'],
  cloudy: ['くもり', 'Cloudy'],
  shower: ['にわか雨', 'Showers'],
  drizzle: ['小雨', 'Drizzle'],
  rain: ['雨', 'Rain'],
  heavy: ['大雨', 'Heavy rain'],
  snow: ['雪', 'Snow'],
  fog: ['霧', 'Fog'],
  hot: ['猛暑', 'Hot'],
  typhoon: ['台風', 'Typhoon'],
  after: ['台風一過', 'Clear after the typhoon'],
};
const ICON: Record<string, string> = { clear: '☀️', night: '🌙', cloudy: '☁️', shower: '🌦️', drizzle: '🌧️', rain: '🌧️', heavy: '⛈️', snow: '❄️', fog: '☁️', hot: '🥵', typhoon: '🌀', after: '☀️' };

/** What to call a forecast minute. */
function kind(o: Outlook, minute: number, weather: Weather = o.weather, amount = o.amount): string {
  const night = minute < 5 * 60 || minute >= 18 * 60 + 30;
  if (o.typhoon > 0.3) return 'typhoon';
  if (weather === 'snow') return 'snow';
  if (weather === 'fog') return 'fog';
  if (weather === 'rain') return o.shower ? 'shower' : amount < 0.3 ? 'drizzle' : amount > 0.7 ? 'heavy' : 'rain';
  if (o.tsuyu) return 'cloudy';
  if (o.after && !night) return 'after';
  if (o.heat && !night && o.temp >= 33) return 'hot';
  return night ? 'night' : 'clear';
}

export class WeatherApp implements PhoneApp {
  readonly id = 'weather';
  readonly name = '天気';
  readonly icon = '⛅';
  readonly color = '#2e8fd0';
  private root: HTMLDivElement | null = null;
  private shownAt = -1;

  constructor(private readonly src: WeatherSource) {}

  show(screen: HTMLElement): void {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'wx-root';
    screen.append(this.root);
    this.shownAt = -1;
    this.render();
  }

  hide(): void {
    this.root = null;
  }

  tick(): void {
    // Redrawn as the clock moves on (each game ten minutes).
    if (this.root && Math.floor(this.src.now() / 10) !== this.shownAt) this.render();
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const now = Math.floor(this.src.now());
    this.shownAt = Math.floor(now / 10);
    const minute = now % DAY;
    const o = this.src.at(now);
    const cur = this.src.current();
    const k = kind(o, minute, cur.weather, cur.amount);
    // At night the sky's icon is the moon's phase while it's up, the stars once it's set.
    const nightIcon = (t: number): string => {
      const m = this.src.moon(t);
      return m.up > 0.2 ? phaseIcon(m.age) : '✨';
    };
    const icon = k === 'night' ? nightIcon(now) : ICON[k];
    const tags: string[] = [];
    if (o.tsuyu) tags.push('<span class="wx-tag wx-tsuyu">梅雨 rainy season</span>');
    if (o.heat) tags.push('<span class="wx-tag wx-heat">猛暑 heat wave</span>');
    if (o.heat && o.temp >= 31) tags.push('<span class="wx-tag wx-warn">熱中症警戒 heatstroke alert</span>');
    if (o.typhoon > 0) tags.push('<span class="wx-tag">台風 typhoon</span>');
    if (o.typhoon > 0.45) tags.push('<span class="wx-tag wx-warn">暴風警報 storm warning</span>');
    // A typhoon on its way in the next day.
    if (o.typhoon === 0 && [...Array(24).keys()].some((h) => this.src.at(now + h * 60).typhoon > 0.3)) tags.push('<span class="wx-tag wx-warn">台風接近 typhoon approaching</span>');
    // The next 24 hours.
    const hours: string[] = [];
    for (let h = 1; h <= 24; h++) {
      const t = Math.floor(now / 60) * 60 + h * 60;
      const q = this.src.at(t);
      const m = t % DAY;
      const hk = kind(q, m);
      const wet = q.weather === 'rain' || q.weather === 'snow' ? `${Math.round(q.amount * 8 + 1)} mm` : '';
      hours.push(`<div class="wx-hour"><div class="wx-h">${hhmm(m).slice(0, 2)}時</div><div class="wx-i">${hk === 'night' ? nightIcon(t) : ICON[hk]}</div><div class="wx-t">${Math.round(q.temp)}°</div><div class="wx-r">${wet}</div></div>`);
    }
    // The next five days: the sky through the day, high and low, the chance of rain (the share of its daytime
    // hours with some).
    const days: string[] = [];
    const today = Math.floor(now / DAY);
    for (let d = 0; d < 6; d++) {
      const base = (today + d) * DAY;
      let hi = -99;
      let lo = 99;
      let wet = 0;
      let snow = 0;
      let fogs = 0;
      let hot = false;
      let tsuyu = false;
      let storm = false;
      for (let h = 0; h < 24; h++) {
        const q = this.src.at(base + h * 60 + 30);
        hi = Math.max(hi, q.temp);
        lo = Math.min(lo, q.temp);
        tsuyu ||= q.tsuyu;
        storm ||= q.typhoon > 0.3;
        hot ||= q.heat && q.temp >= 33;
        if (h >= 6 && h < 21) {
          if (q.weather === 'rain') wet++;
          if (q.weather === 'snow') snow++;
          if (q.weather === 'fog') fogs++;
        }
      }
      const chance = Math.min(100, Math.round(((wet + snow) / 15) * 100 / 10) * 10 + (wet + snow > 0 ? 10 : 0));
      const dk = storm ? 'typhoon' : snow > 2 ? 'snow' : wet > 6 ? 'rain' : wet > 0 ? 'shower' : fogs > 2 ? 'fog' : tsuyu ? 'cloudy' : hot ? 'hot' : 'clear';
      const wd = weekdayOf(today + d + 1);
      const name = d === 0 ? '今日 Today' : d === 1 ? '明日 Tomorrow' : `${WEEKDAYS[wd]} ${WEEKDAYS_EN[wd]}`;
      days.push(`<div class="wx-day"><div class="wx-dn">${name}</div><div class="wx-di">${ICON[dk]}</div><div class="wx-dl">${LABEL[dk][0]}</div><div class="wx-dt"><b>${Math.round(hi)}°</b> ${Math.round(lo)}°</div><div class="wx-dc">☂ ${chance}%</div></div>`);
    }
    root.innerHTML = `
      <div class="wx-now wx-${k}">
        <div class="wx-place">東都市 TŌTO · ${this.src.season()} · ${hhmm(minute)}</div>
        <div class="wx-big"><span class="wx-icon">${icon}</span><span class="wx-temp">${Math.round(airWith(o, cur.weather))}°</span></div>
        <div class="wx-cond">${LABEL[k][0]} <span>${LABEL[k][1]}</span></div>
        <div class="wx-tags">${tags.join('')}</div>
      </div>
      <div class="wx-sec">24時間 Next 24 hours</div>
      <div class="wx-hours">${hours.join('')}</div>
      <div class="wx-sec">週間 This week</div>
      <div class="wx-days">${days.join('')}</div>
      <div class="wx-sec">月と太陽 Sun &amp; moon</div>
      ${this.sunMoon(now)}`;
  }

  /** Tonight's moon (its phase, old name, age, how much of it is lit, when it rises and sets) and the sun's day. */
  private sunMoon(now: number): string {
    const m = this.src.moon(now);
    const [jp, en] = moonName(m.age);
    const times = moonTimes((t) => this.src.moon(t), now);
    const at = (dt: number | null): string => (dt === null ? '—' : `${dt >= DAY - (now % DAY) ? '明日 ' : ''}${hhmm((now + dt) % DAY)}`);
    const dl = this.src.daylight();
    return `<div class="wx-sm">
        <div class="wx-moon"><div class="wx-mi">${phaseIcon(m.age)}</div><div>
          <div class="wx-mn">${jp}<span>${en}</span></div>
          <div class="wx-ms">月齢 age ${m.age.toFixed(1)} · ${Math.round(m.lit * 100)}% lit${m.up > 0.2 ? ' · up now' : ''}</div>
        </div></div>
        <div class="wx-times">
          <div>月の出 Moonrise <b>${at(times.rise)}</b></div><div>月の入 Moonset <b>${at(times.set)}</b></div>
          <div>日の出 Sunrise <b>${hhmm(dl.rise)}</b></div><div>日の入 Sunset <b>${hhmm(dl.set)}</b></div>
        </div>
      </div>`;
  }
}

export interface MoonTimes {
  /** Minutes from now to the next moonrise and moonset (within two days), or null. */
  readonly rise: number | null;
  readonly set: number | null;
}

/** When the moon next rises and sets, from now (it crosses the horizon going up, then coming down). */
export function moonTimes(moon: (total: number) => MoonNow, now: number): MoonTimes {
  let rise: number | null = null;
  let set: number | null = null;
  let prev = moon(now).dir[1] > 0;
  for (let t = 5; t <= 2 * DAY && (rise === null || set === null); t += 5) {
    const up = moon(now + t).dir[1] > 0;
    if (up && !prev && rise === null) rise = t;
    if (!up && prev && set === null) set = t;
    prev = up;
  }
  return { rise, set };
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .wx-root { flex: 1; overflow-y: auto; background: #0e1420; color: #eef2fa; font-size: 13px; }
  .wx-now { padding: 16px 16px 14px; background: linear-gradient(180deg, #2d7fd0, #1a4f8a); }
  .wx-now.wx-night { background: linear-gradient(180deg, #1b2450, #0f1530); }
  .wx-now.wx-cloudy, .wx-now.wx-fog { background: linear-gradient(180deg, #6a7686, #3e4856); }
  .wx-now.wx-rain, .wx-now.wx-drizzle, .wx-now.wx-shower, .wx-now.wx-heavy { background: linear-gradient(180deg, #45566e, #26303e); }
  .wx-now.wx-snow { background: linear-gradient(180deg, #8aa0bc, #52627a); }
  .wx-now.wx-hot { background: linear-gradient(180deg, #e0782a, #a8401e); }
  .wx-now.wx-typhoon { background: linear-gradient(180deg, #3a4458, #151a26); }
  .wx-place { font-size: 11.5px; opacity: 0.85; letter-spacing: 0.5px; }
  .wx-big { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .wx-icon { font-size: 44px; }
  .wx-temp { font-size: 46px; font-weight: 300; }
  .wx-cond { font-size: 17px; font-weight: 700; margin-top: 2px; }
  .wx-cond span { font-size: 12px; font-weight: 400; opacity: 0.8; margin-left: 4px; }
  .wx-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .wx-tag { font-size: 10.5px; padding: 3px 7px; border-radius: 10px; background: rgba(255,255,255,0.18); }
  .wx-tag.wx-warn { background: #d8321e; font-weight: 700; }
  .wx-sec { font-size: 11px; color: #8ea0bc; letter-spacing: 1px; margin: 12px 14px 6px; }
  .wx-hours { display: flex; gap: 2px; overflow-x: auto; padding: 0 10px 4px; }
  .wx-hour { flex: 0 0 44px; text-align: center; padding: 6px 0; border-radius: 8px; background: #172030; }
  .wx-h { font-size: 10.5px; color: #9aaccc; }
  .wx-i { font-size: 19px; margin: 3px 0; }
  .wx-t { font-size: 13px; font-weight: 600; }
  .wx-r { font-size: 9.5px; color: #7ec0ff; min-height: 11px; }
  .wx-days { padding: 0 10px 14px; display: grid; gap: 4px; }
  .wx-day { display: grid; grid-template-columns: 1fr 30px 56px 70px 48px; align-items: center; gap: 4px; padding: 7px 8px; border-radius: 8px; background: #172030; }
  .wx-dn { font-size: 12px; }
  .wx-di { font-size: 19px; text-align: center; }
  .wx-dl { font-size: 11.5px; color: #c8d4ea; }
  .wx-dt { font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }
  .wx-dt b { color: #ffb08a; }
  .wx-dc { font-size: 11px; color: #7ec0ff; text-align: right; }
  .wx-sm { margin: 0 10px 16px; padding: 10px 12px; border-radius: 10px; background: #172030; display: grid; gap: 8px; }
  .wx-moon { display: flex; align-items: center; gap: 12px; }
  .wx-mi { font-size: 34px; }
  .wx-mn { font-size: 15px; font-weight: 700; }
  .wx-mn span { font-size: 11.5px; font-weight: 400; color: #c8d4ea; margin-left: 4px; }
  .wx-ms { font-size: 11.5px; color: #9aaccc; margin-top: 2px; }
  .wx-times { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .wx-times b { color: #c8d4ea; font-weight: 600; }
  `;
  document.head.append(s);
}
