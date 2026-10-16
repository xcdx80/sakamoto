/** Browser caches follow the active authenticated identity; legacy unscoped data belongs only to anonymous storage. */
let active: string | null = null;
let epoch = 0;
export const accountScope = () => active;
export const accountEpoch = () => epoch;
export function selectAccount(owner: string | null) {
  active = owner;
  epoch++;
}
export const scopedKey = (legacy: string, owner: string | null = active) => (owner ? `sakamoto:account:${encodeURIComponent(owner)}:${legacy}` : legacy);
