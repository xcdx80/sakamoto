/**
 * The Sakamoto seal: a vermilion hanko with an open book resting on a slope.
 * 坂本, Sakamoto, reads as "slope" and "book". One geometry, shared by the
 * header, the icons and the social card, in a 24-unit square.
 */
export const MARK = {
  seal: { x: 2.25, y: 2.25, size: 19.5, radius: 5.25 },
  /** The book leans with the slope it rests on. */
  tilt: "rotate(-12 12 12.6)",
  pages: [
    "M11.55 9.05C9.9 7.95 8.05 7.7 6.2 8.15V15.5C8.05 15.05 9.9 15.3 11.55 16.4Z",
    "M12.45 9.05C14.1 7.95 15.95 7.7 17.8 8.15V15.5C15.95 15.05 14.1 15.3 12.45 16.4Z",
  ],
  slope: "M5.4 19.05L18.6 16.25",
  ink: "#d3431a",
  paper: "#fffaf1",
} as const;

/** The seal as a standalone SVG document, for icons and static images. */
export function markSvg(size = 24, { background }: { background?: string } = {}) {
  const { seal, tilt, pages, slope, ink, paper } = MARK;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${background ? `<rect width="24" height="24" fill="${background}"/>` : ""}<rect x="${seal.x}" y="${seal.y}" width="${seal.size}" height="${seal.size}" rx="${seal.radius}" fill="${ink}"/><g transform="${tilt}" fill="${paper}">${pages.map(d => `<path d="${d}"/>`).join("")}</g><path d="${slope}" stroke="${paper}" stroke-width="1.35" stroke-linecap="round"/></svg>`;
}
