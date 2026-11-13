/** Regenerates the InView icons from components/brand/mark.ts. Uses sharp, which ships with Next.js: node --import tsx scripts/generate-brand-assets.mts */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { markSvg, MARK } from "../components/brand/mark.ts";
import { BRAND } from "../lib/brand.ts";
const app = new URL("../app/", import.meta.url).pathname;
writeFileSync(app + "icon.svg", markSvg(32, { background: true }) + "\n");
const png = (size: number, svg: string) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
// The paper background keeps the mark readable on any launcher or browser chrome.
writeFileSync(app + "apple-icon.png", await png(180, markSvg(180, { background: true })));
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => png(size, markSvg(size, { background: true }))));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const at = 6 + i * 16;
  header.writeUInt8(size, at); header.writeUInt8(size, at + 1); header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12); offset += images[i].length;
});
writeFileSync(app + "favicon.ico", Buffer.concat([header, ...images]));
console.log("InView icons written");

const publicDir = new URL("../public/", import.meta.url);
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${MARK.paper}"/>
  <g transform="translate(80 79)">${markSvg(60)}</g>
  <g font-family="Georgia, serif" fill="${MARK.front.fill}">
    <text x="160" y="124" font-size="42">${BRAND.name}</text>
    <text x="80" y="295" font-size="76">Bring what you’ve read</text>
    <text x="80" y="385" font-size="76">back into view.</text>
  </g>
  <text x="80" y="490" font-family="Arial, sans-serif" font-size="24" fill="#686258">Your library. Your notes. Answers with sources.</text>
</svg>`;
writeFileSync(new URL("inview.svg", publicDir), card + "\n");
await sharp(Buffer.from(card)).png().toFile(new URL("og.png", publicDir).pathname);
await sharp(Buffer.from(card)).jpeg({ quality: 92 }).toFile(new URL("og.jpg", publicDir).pathname);

if (process.argv.includes("--brand-only")) process.exit(0);

/* ---------- covers: flat risograph-style prints, one idea per essay ---------- */
const W = 600, H = 900;
const C = { paper: "#f4ecdc", ink: "#1f1c18", vermilion: "#d3431a", marigold: "#f0b93a", cobalt: "#2f56c8", moss: "#4f7a4c", blush: "#efb3bf", sky: "#a9cbe6", kraft: "#c9a877", lilac: "#b5a8dc", sea: "#2c6e8f", night: "#1d2a44", cream: "#fbf5e8" };
const grain = `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .1 0 0 0 0 .08 0 0 0 0 .06 0 0 0 .22 0"/></filter><rect width="${W}" height="${H}" filter="url(#g)"/>`;
const frame = (bg: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}${grain}<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${C.ink}" stroke-opacity=".14" stroke-width="2"/></svg>`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const COVERS: Record<string, string> = {
  "hamming-research": frame(C.cobalt, `<circle cx="300" cy="420" r="190" fill="${C.marigold}"/>${range(6).map(i => `<rect x="${90 + i * 72}" y="${720 - i * 70}" width="62" height="${120 + i * 70}" fill="${C.cream}"/>`).join("")}<rect x="0" y="780" width="600" height="120" fill="${C.ink}" opacity=".9"/>`),
  "feynman-cargo": frame(C.kraft, `<rect x="0" y="0" width="600" height="420" fill="${C.night}"/><circle cx="430" cy="150" r="42" fill="${C.cream}"/><polygon points="270,420 330,420 560,900 40,900" fill="${C.moss}"/>${range(7).map(i => { const t = i / 6, y = 450 + t * t * 400, s = 6 + t * 18, dx = 40 + t * 250; return `<circle cx="${300 - dx}" cy="${y}" r="${s}" fill="${C.vermilion}"/><circle cx="${300 + dx}" cy="${y}" r="${s}" fill="${C.vermilion}"/>`; }).join("")}<rect x="96" y="300" width="70" height="120" fill="${C.kraft}"/><rect x="80" y="280" width="102" height="24" fill="${C.cream}"/>`),
  "orwell-politics": frame(C.paper, range(15).map(i => { const y = 140 + i * 44, w = 360 + ((i * 97) % 120); return `<rect x="90" y="${y}" width="${w}" height="10" rx="5" fill="${C.ink}" opacity=".22"/>${i % 3 !== 1 ? `<rect x="${90 + ((i * 53) % 140)}" y="${y - 8}" width="${120 + ((i * 41) % 160)}" height="26" fill="${C.ink}"/>` : ""}`; }).join("") + `<rect x="360" y="760" width="150" height="54" rx="6" fill="none" stroke="${C.vermilion}" stroke-width="5" transform="rotate(-8 435 787)"/>`),
  "sutton-bitter": frame(C.moss, `<path d="M60 760 C 220 740 300 560 360 420 S 470 180 560 140" fill="none" stroke="${C.cream}" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 26"/><ellipse cx="300" cy="460" rx="170" ry="128" fill="${C.marigold}" transform="rotate(-24 300 460)"/><ellipse cx="300" cy="460" rx="122" ry="88" fill="none" stroke="${C.cream}" stroke-width="5" opacity=".6" transform="rotate(-24 300 460)"/><path d="M430 330 C 480 260 540 260 560 280 C 520 320 480 340 430 330Z" fill="${C.ink}" opacity=".85"/>`),
  "karpathy-sw2": frame(C.night, (() => { const r = rand(7), pts = range(5).flatMap(c => range(4 + (c % 2)).map(k => [110 + c * 95, 220 + k * (460 / (3 + (c % 2))) + (c % 2 ? 0 : 50)])); return pts.flatMap(([x, y], i) => pts.filter(([x2]) => x2 === x + 95).map(([x2, y2]) => `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${C.sky}" stroke-opacity="${(0.15 + r() * 0.5).toFixed(2)}" stroke-width="2"/>`)).join("") + pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="15" fill="${i % 7 === 3 ? C.vermilion : C.sky}"/>`).join(""); })()),
  "gabriel-worse": frame(C.lilac, `${range(7).map(i => `<rect x="${60 + i * 70}" y="${300 + i * 62}" width="70" height="${600 - i * 62}" fill="${C.cream}"/>`).join("")}<circle cx="540" cy="${270 + 6 * 62}" r="30" fill="${C.vermilion}"/><path d="M150 240 q90 -110 180 -20 t170 10" fill="none" stroke="${C.ink}" stroke-width="5" stroke-dasharray="4 16" stroke-linecap="round"/><circle cx="120" cy="250" r="26" fill="${C.ink}"/>`),
  licklider: frame(C.sky, `<circle cx="245" cy="430" r="165" fill="${C.cream}"/><rect x="250" y="270" width="320" height="320" rx="28" fill="${C.cobalt}" opacity=".88"/><path d="M250 330 a165 165 0 0 1 0 200" fill="${C.vermilion}"/>${range(4).map(i => `<rect x="300" y="${330 + i * 50}" width="${200 - i * 30}" height="12" rx="6" fill="${C.cream}" opacity=".85"/>`).join("")}`),
  "pg-dont-scale": frame(C.marigold, `${range(12).flatMap(r => range(8).map(c => `<circle cx="${90 + c * 60}" cy="${150 + r * 56}" r="7" fill="${C.ink}" opacity=".28"/>`)).join("")}<circle cx="330" cy="430" r="64" fill="${C.vermilion}"/><path d="M300 430 l22 22 42 -48" fill="none" stroke="${C.cream}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`),
  "kelly-fans": frame(C.paper, (() => { const r = rand(31); return range(40).flatMap(row => range(25).map(col => `<circle cx="${84 + col * 18}" cy="${110 + row * 18}" r="5" fill="${r() < 0.03 ? C.vermilion : C.ink}" opacity="${r() < 0.03 ? 1 : 0.62}"/>`)).join(""); })()),
  "pg-great-work": frame(C.blush, `<circle cx="420" cy="230" r="70" fill="${C.cream}"/><polygon points="40,820 250,330 380,560 450,450 580,820" fill="${C.ink}"/><polygon points="250,330 300,445 270,420 230,455 205,430" fill="${C.cream}"/><line x1="250" y1="330" x2="250" y2="250" stroke="${C.ink}" stroke-width="6"/><polygon points="250,250 312,272 250,294" fill="${C.vermilion}"/>`),
  "dfw-water": frame(C.sea, `${range(9).map(i => `<path d="M0 ${300 + i * 62} q75 -26 150 0 t150 0 t150 0 t150 0" fill="none" stroke="${C.cream}" stroke-opacity="${0.18 + i * 0.07}" stroke-width="7"/>`).join("")}<g transform="translate(200 470)"><ellipse rx="62" ry="28" fill="${C.marigold}"/><polygon points="58,0 102,-28 102,28" fill="${C.marigold}"/><circle cx="-34" cy="-6" r="6" fill="${C.ink}"/></g><g transform="translate(400 640) scale(-.8 .8)"><ellipse rx="62" ry="28" fill="${C.vermilion}"/><polygon points="58,0 102,-28 102,28" fill="${C.vermilion}"/><circle cx="-34" cy="-6" r="6" fill="${C.ink}"/></g>`),
  "urban-tail": frame(C.kraft, range(30).flatMap(r => range(18).map(c => { const i = r * 18 + c, done = i < 470; return `<rect x="${78 + c * 25}" y="${110 + r * 23}" width="16" height="16" rx="3" fill="${done ? C.ink : "none"}" stroke="${C.ink}" stroke-width="2" opacity="${done ? 0.7 : 0.9}"/>`; })).join("") + `<rect x="${78 + (470 % 18) * 25}" y="${110 + Math.floor(470 / 18) * 23}" width="16" height="16" rx="3" fill="${C.vermilion}"/>`),
  "on-a-piece-of-chalk": frame(C.sky, `<rect x="0" y="620" width="600" height="280" fill="${C.cobalt}" opacity=".75"/>${range(7).map(i => `<path d="M0 ${250 + i * 52} C 160 ${230 + i * 52} 340 ${280 + i * 52} 600 ${240 + i * 52} V 650 H 0Z" fill="${i % 2 ? C.cream : "#ece6d6"}"/>`).join("")}<path d="M380 250 l40 0 -18 400 -40 0z" fill="${C.ink}" opacity=".08"/><circle cx="470" cy="150" r="46" fill="${C.marigold}"/>`),
  "on-thinking-for-oneself": frame(C.paper, `<path d="M190 820 C 190 700 150 660 150 560 C 150 400 260 300 380 320 C 470 335 520 410 500 480 L 530 540 L 495 556 C 500 600 490 640 450 650 L 420 652 L 420 820Z" fill="${C.lilac}"/><circle cx="350" cy="470" r="48" fill="${C.marigold}"/>${range(8).map(i => { const a = (i / 8) * Math.PI * 2; return `<line x1="${350 + Math.cos(a) * 66}" y1="${470 + Math.sin(a) * 66}" x2="${350 + Math.cos(a) * 92}" y2="${470 + Math.sin(a) * 92}" stroke="${C.vermilion}" stroke-width="7" stroke-linecap="round"/>`; }).join("")}`),
  "walden-reading": frame(C.moss, `<rect x="0" y="560" width="600" height="340" fill="${C.sea}"/><ellipse cx="300" cy="610" rx="250" ry="30" fill="${C.sky}" opacity=".55"/>${range(6).map(i => `<polygon points="${70 + i * 95},560 ${110 + i * 95},${330 + (i % 3) * 40} ${150 + i * 95},560" fill="${C.ink}" opacity=".78"/>`).join("")}<rect x="250" y="470" width="100" height="90" fill="${C.cream}"/><polygon points="236,474 300,420 364,474" fill="${C.vermilion}"/><rect x="288" y="510" width="24" height="50" fill="${C.ink}"/><circle cx="460" cy="180" r="40" fill="${C.cream}"/>`),
};
const covers = new URL("../public/library/covers/", import.meta.url).pathname;
for (const [key, svg] of Object.entries(COVERS)) await sharp(Buffer.from(svg)).webp({ quality: 86 }).toFile(covers + key + ".webp");
console.log("covers written", Object.keys(COVERS).length);
