"use client";

import { easeInOut, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity, type MotionValue } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";
import { spring } from "@/components/motion/tokens";
import { at, type Viewport } from "./clock";
import { PIECES, type PieceDef } from "./placement";

let topLayer = 40;

function Piece({ def, index, view, position, p, pointerX, pointerY, bounds, scale }: {
  def: PieceDef;
  index: number;
  view: Viewport;
  position: [number, number];
  p: MotionValue<number>;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  bounds: RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const reduced = useReducedMotion();
  const card = useRef<HTMLDivElement>(null);
  const restX = ((position[0] - 50) / 100) * view.w;
  const restY = ((position[1] - 50) / 100) * view.h;
  const radius = Math.hypot(restX, restY);
  const angle = Math.atan2(restY, restX);

  // Gathered late and spiralling in, so the mess visibly becomes a stack.
  const gather = useTransform(p, [at(1.2 + (index % 7) * 0.05), at(2.02)], [0, 1], { ease: easeInOut });
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const stackX = ((index % 5) - 2) * 3;
  const stackY = -index * 1.6;

  const x = useTransform([gather, dragX] as MotionValue<number>[], ([g, d]: number[]) => {
    const r = radius * (1 - g);
    return r * Math.cos(angle + 2.1 * g) - restX + (stackX - d) * g;
  });
  const y = useTransform([gather, dragY] as MotionValue<number>[], ([g, d]: number[]) => {
    const r = radius * (1 - g);
    return r * Math.sin(angle + 2.1 * g) - restY + (stackY - d) * g;
  });
  const size = useTransform(gather, [0, 1], [scale, scale * 0.82]);
  const opacity = useTransform(p, [at(2.0), at(2.16)], [1, 0]);
  const visibility = useTransform(opacity, (v) => (v <= 0.002 ? "hidden" : "visible"));

  const driftX = useTransform([pointerX, gather] as MotionValue<number>[], ([m, g]: number[]) => m * def.depth * 22 * (1 - g));
  const driftY = useTransform([pointerY, gather] as MotionValue<number>[], ([m, g]: number[]) => m * def.depth * 16 * (1 - g));

  const speed = useVelocity(dragX);
  const tilt = useSpring(useTransform(speed, [-1800, 1800], [-16, 16]), { stiffness: 260, damping: 18 });
  const stackRotate = ((index % 5) - 2) * 2.4;
  const rotate = useTransform([tilt, gather] as MotionValue<number>[], ([t, g]: number[]) => def.rotate + t * (1 - g) + (stackRotate - def.rotate) * g);
  const layer = useMotionValue(index + 1);

  // A deterministic throw from just past whichever edge is nearest.
  const fromLeft = position[0] < 50;
  const throwX = (fromLeft ? -1 : 1) * (view.w * 0.32 + (index % 4) * 70);
  const throwY = (position[1] < 50 ? -1 : 1) * (view.h * 0.28 + (index % 3) * 60);

  return (
    // Keep drag in desk pixels; the entrance, parallax and scale only move the artwork.
    <motion.div
      ref={card}
      className="pc-grab"
      style={{ left: `calc(50% + ${restX}px)`, top: `calc(50% + ${restY}px)`, x: dragX, y: dragY, opacity, visibility, zIndex: layer }}
      drag
      dragConstraints={bounds}
      onMeasureDragConstraints={({ left, right, top, bottom }) => {
        // Motion measures the full-size wrapper. The artwork is scaled around its center.
        const insetX = (card.current?.offsetWidth ?? 0) * (1 - scale) / 2;
        const insetY = (card.current?.offsetHeight ?? 0) * (1 - scale) / 2;
        // Some cards intentionally start partly off the desk. Keep their origin reachable.
        return {
          left: Math.min(left - insetX, 0), right: Math.max(right + insetX, 0),
          top: Math.min(top - insetY, 0), bottom: Math.max(bottom + insetY, 0),
        };
      }}
      dragElastic={0.14}
      dragMomentum
      dragTransition={{ power: 0.22, timeConstant: 260 }}
      whileHover="hover"
      whileDrag="drag"
      onDragStart={() => layer.set(++topLayer)}
    >
      <motion.div style={{ x, y, scale: size }}>
        <motion.div style={{ x: driftX, y: driftY }}>
          <motion.div
            initial={reduced ? false : { x: throwX, y: throwY, rotate: (index % 2 ? 1 : -1) * 34, opacity: 0 }}
            animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 58, damping: 13, mass: 1, delay: 0.25 + index * 0.05, opacity: { duration: 0.3, delay: 0.25 + index * 0.05 } }}
          >
            <motion.div
              className="pc-artwork"
              data-desk-piece={def.id}
              style={{ rotate }}
              variants={{
                hover: { scale: 1.05 },
                drag: { scale: 1.05, filter: "drop-shadow(0 22px 20px rgb(40 30 20 / 0.28))" },
              }}
              transition={spring.snap}
            >
              {def.node}
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/** Everything anyone ever saved, thrown onto the desk. Pick it up, it moves. */
export function Pieces({ view, p, bounds }: { view: Viewport; p: MotionValue<number>; bounds: RefObject<HTMLDivElement | null> }) {
  const reduced = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const pointerX = useSpring(rawX, { stiffness: 60, damping: 18 });
  const pointerY = useSpring(rawY, { stiffness: 60, damping: 18 });

  useEffect(() => {
    if (reduced || view.compact) return;
    const move = (e: PointerEvent) => {
      rawX.set(e.clientX / window.innerWidth - 0.5);
      rawY.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [reduced, view.compact, rawX, rawY]);

  const scale = view.compact ? Math.min(0.62, view.w / 600) : view.w < 1240 ? 0.8 : view.w < 1500 ? 0.94 : 1;
  const shown = PIECES.filter((d) => (view.compact ? !!d.phone : view.w < 1240 ? d.tier < 2 : true));

  return (
    <div className="pc-layer" aria-hidden>
      {shown.map((def, i) => (
        <Piece key={def.id} def={def} index={i} view={view} position={view.compact ? def.phone! : def.at} p={p} pointerX={pointerX} pointerY={pointerY} bounds={bounds} scale={scale} />
      ))}
    </div>
  );
}
