/** A folded page corner with a small brass flap beneath the fold. */
export const MARK = {
  paper: "#faf7f0",
  front: { d: "M3 3H21L3 21Z", fill: "#252525" },
  flap: { d: "M8 17.5L14.5 11V17.5Z", fill: "#ab8139" },
} as const;

/** The mark as a standalone SVG document, for icons and static images. */
export function markSvg(size = 24, { background = false }: { background?: boolean } = {}) {
  const paper = background ? `<rect width="24" height="24" fill="${MARK.paper}"/>` : "";
  const paths = [MARK.front, MARK.flap].map(({ d, fill }) => `<path d="${d}" fill="${fill}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${paper}${paths}</svg>`;
}
