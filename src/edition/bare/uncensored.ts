// The uncensored edition: loads the bare-body detail from adult/ (its own repository), which registers itself
// (src/poc3d/real/mobBare.ts). Without the folder the glob is empty and the figures are the standard ones.
import.meta.glob('../../../adult/src/mobBare.ts', { eager: true });
export {};
