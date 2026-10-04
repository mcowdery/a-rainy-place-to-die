/**
 * What's underfoot and what's on your feet (pure): the surfaces a footstep can land on, what each set piece's
 * floors and grounds are made of, and the footwear that goes with each of Mack's outfits. `District.surfaceAt`
 * says which surface a point is; real/audio.ts has a sound for each surface in each kind of footwear.
 */

export const SURFACES = ['asphalt', 'paving', 'tile', 'wood', 'tatami', 'carpet', 'metal', 'grass', 'gravel', 'earth', 'snow'] as const;
/**
 * - `asphalt`: carriageways, lanes, car parks, decks.
 * - `paving`: pavements, plazas, concrete floors and stairs, platforms.
 * - `tile`: hard indoor floors (shops, stations underground, the bath hall, lobbies, hospital lino).
 * - `wood`: boards (flats, the changing room, the lookout's deck).
 * - `tatami`, `carpet`: soft floors.
 * - `metal`: a vehicle's floor (trains, buses).
 * - `grass`: lawns, verges, planted medians.
 * - `gravel`: park paths, vacant lots, the shrine's precinct.
 * - `earth`: bare ground (playgrounds, the building site).
 * - `snow`: settled snow over any outdoor ground.
 */
export type Surface = (typeof SURFACES)[number];

export const FOOTWEAR = ['boots', 'shoes', 'bare'] as const;
/** Heavy boots (the leathers), leather-soled dress shoes (the suits), or bare feet. */
export type Footwear = (typeof FOOTWEAR)[number];

/** Where a floor is: at street level, on a storey above it, or below ground. */
export type FloorLevel = 'street' | 'above' | 'below';

/** A floor's level from its height above the street (metres). */
export const floorLevel = (h: number): FloorLevel => (h > 0.5 ? 'above' : h < -0.5 ? 'below' : 'street');

type Floors = Surface | { readonly [L in FloorLevel]?: Surface };

/**
 * The floors inside each kind of set piece (stamps' `landmark`): one surface, or one per level. Coarse on purpose
 * (a building's floors, not each room's). A kind that isn't here has a shop's tile at street level and concrete
 * on its other storeys.
 */
const INDOOR: Readonly<Record<string, Floors>> = {
  // Tiled, stone or lino on every floor: stores, stations underground, lobbies, the hospital.
  dept_store: 'tile',
  discount: 'tile',
  hospital: 'tile',
  maid_cafe: 'tile',
  subway: 'tile',
  rotary: 'tile',
  airport_terminal: 'tile',
  ferry_terminal: 'tile',
  tv_station: 'tile',
  idol_agency: 'tile',
  police_hq: 'tile',
  // Homes: tatami in the old flats and the inn, boards in the newer ones.
  apato: 'tatami',
  danchi: 'tatami',
  ryokan: 'tatami',
  mansion: 'wood',
  dorm: 'wood',
  villa: 'wood',
  // The Peak: a stone lobby, boards up in the penthouse.
  residence: { street: 'tile', above: 'wood' },
  net_cafe: 'carpet',
  love_hotel: 'carpet',
  members_club: 'carpet',
  biz_hotel: 'carpet',
  city_hall: { street: 'tile', above: 'carpet' },
  arcade: 'carpet',
  // Cash One's building: the pawn shop's floor, concrete flights, the office's carpet tiles.
  zakkyo: { street: 'tile', above: 'paving' },
  sento: 'wood',
  // Concrete: platforms and concourses over the street, basements, sheds.
  station: 'paving',
  live_house: 'paving',
  yokocho: 'paving',
  garage: 'paving',
  tuning_shop: 'paving',
  fish_market: 'paving',
  flood_shaft: 'paving',
  car_park: 'asphalt',
  lookout: { above: 'wood' },
};

/** A set piece's own ground at street level, out of doors, where it isn't the city's paving. */
const GROUNDS: Readonly<Record<string, Surface>> = {
  shrine: 'gravel',
  ryokan: 'gravel',
  yakuza_house: 'gravel',
  construction: 'earth',
  ruined_park: 'grass',
  parking_area: 'asphalt',
  car_park: 'asphalt',
  rotary: 'asphalt',
};

/** The floor inside a set piece of this kind, at this level. */
export function indoorSurface(kind: string | null, level: FloorLevel): Surface {
  const f = kind ? INDOOR[kind] : undefined;
  if (typeof f === 'string') return f;
  // (Unknown storeys and basements are concrete; a room at street level is a shop's tile.)
  return f?.[level] ?? (level === 'street' ? 'tile' : 'paving');
}

/** A set piece's grounds, if they're its own. */
export const groundSurface = (kind: string | null): Surface | null => (kind ? GROUNDS[kind] ?? null : null);

/** Out of doors, on the ground: snow lies on all of it once enough has settled. */
export const OUTDOOR: ReadonlySet<Surface> = new Set(['asphalt', 'paving', 'grass', 'gravel', 'earth']);
export const SNOW_UNDERFOOT = 0.3;

/** The surface a step lands on, with the weather: settled snow covers open ground. */
export function underfoot(surface: Surface, snow: number, open: boolean): Surface {
  return open && snow >= SNOW_UNDERFOOT && OUTDOOR.has(surface) ? 'snow' : surface;
}
