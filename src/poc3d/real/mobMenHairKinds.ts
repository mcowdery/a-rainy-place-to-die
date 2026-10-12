/**
 * Men's hairstyles (2026-10-10; the user: more hairstyles, along with the new male builds): their names, and how the
 * classic generation draws each (as its one short cut). The geometry is in mobMenHair.ts. Like the women's detailed
 * cuts (mobHairKinds.ts) they are `Hair` kinds appended to the template lists, so no existing template's index moves;
 * only the shaped generation draws them, and only on a man (a build, an elder, the ordinary man).
 */
export const MEN_HAIR = [
  'm_side_part', 'm_crew', 'm_quiff', 'm_messy', 'm_perm', 'm_slick_long', 'm_undercut', 'm_bowl',
  'm_long', 'm_mullet', 'm_bun', 'm_ponytail', 'm_topknot', 'm_receding', 'm_horseshoe',
] as const;
export type MenHair = (typeof MEN_HAIR)[number];
export const isMenHair = (hair: string): hair is MenHair => (MEN_HAIR as readonly string[]).includes(hair);
/** The showroom's names for them (men.html). */
export const MEN_HAIR_NAMES: Readonly<Record<MenHair, string>> = {
  m_side_part: 'side part', m_crew: 'crew cut', m_quiff: 'quiff', m_messy: 'messy spikes', m_perm: 'perm', m_slick_long: 'slicked back, long',
  m_undercut: 'undercut', m_bowl: 'bowl cut', m_long: 'collar length', m_mullet: 'mullet', m_bun: 'man bun', m_ponytail: 'low ponytail',
  m_topknot: 'topknot', m_receding: 'receding', m_horseshoe: 'bald on top',
};
