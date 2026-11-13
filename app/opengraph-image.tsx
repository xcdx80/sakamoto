import { ImageResponse } from "next/og";
import { MARK } from "@/components/brand/mark";
import { BRAND, OG_IMAGE } from "@/lib/brand";

export const alt = OG_IMAGE.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function SocialImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: MARK.paper, color: MARK.front.fill }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: 40, marginBottom: "64px" }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path {...MARK.front} />
            <path {...MARK.flap} />
          </svg>
          {BRAND.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.12, letterSpacing: "-3px" }}>
          <span>Bring what you’ve read</span>
          <span>back into view.</span>
        </div>
        <div style={{ fontSize: 24, color: "#686258", marginTop: "40px" }}>Your library. Your notes. Answers with sources.</div>
      </div>
    ),
    size,
  );
}
