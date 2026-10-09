/**
 * The currency the player's money is shown in: yen in Tōto, pesos in Manila (cityConfig.ts `currency`). It is one
 * wallet (race/profile.ts) with a city's symbol on it; set once at startup by the city page.
 */
let SYMBOL = '¥';
export const setCurrency = (symbol: string): void => void (SYMBOL = symbol);
export const currency = (): string => SYMBOL;
/** An amount as it's shown: the symbol and the number with thousands separators. */
export const money = (n: number): string => `${SYMBOL}${Math.round(n).toLocaleString('en-US')}`;
