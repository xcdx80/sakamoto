/** InView's motion vocabulary. Paper settles, ink draws, stamps thud. */
export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.76, 0, 0.24, 1],
  ink: [0.65, 0, 0.35, 1],
} as const;

export const spring = {
  /** Paper coming to rest. */
  soft: { type: "spring", stiffness: 120, damping: 20, mass: 0.9 },
  /** Tools answering a hand. */
  snap: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 },
  /** Small objects with some joy in them. */
  bouncy: { type: "spring", stiffness: 340, damping: 15, mass: 0.7 },
  /** A stamp landing. */
  thud: { type: "spring", stiffness: 900, damping: 24, mass: 1.1 },
} as const;

export const stagger = { tight: 0.04, base: 0.07, slow: 0.12 } as const;
