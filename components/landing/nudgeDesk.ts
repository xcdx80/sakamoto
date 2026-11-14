const step = 1 / 60;
const frameCount = 60;
const pieceMotionGain = 1.25;

type Point = { x: number; y: number };

function shakeFrames(): Point[] {
  const direction = Math.random() < 0.5 ? -1 : 1;
  const phase = Math.random() * Math.PI * 2;
  const frequency = 9 + Math.random() * 3;

  return Array.from({ length: frameCount + 1 }, (_, index) => {
    const time = index * step;
    const strength = Math.min(1, time / 0.035) * (1 - Math.min(1, time / 0.55)) ** 1.5;
    const wave = time * frequency * Math.PI * 2;
    return {
      x: strength * direction * (9 * Math.sin(wave) + 3 * Math.sin(wave * 0.59 + phase)),
      y: strength * (3 * Math.sin(wave * 0.86 + phase) + 2 * Math.cos(wave * 1.23)),
    };
  });
}

type CardPose = Point & { angle: number };
type Contact = Point & { grip: number };

function pieceContacts(id: string, width: number, height: number): Contact[] {
  // Keep the grip and balance of each piece consistent between nudges.
  let hash = 2166136261;
  for (const letter of id) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  const fraction = (bit: number) => ((hash >>> bit) & 255) / 255;
  const grip = 650 * 16 ** fraction(0);
  const balance = 0.24 + fraction(8) * 0.52;
  const side = fraction(16) < 0.5 ? -1 : 1;
  const lever = 0.18 + fraction(24) * 0.16;

  return [
    { x: -width * lever, y: -height * side / 4, grip: grip * balance },
    { x: width * lever, y: height * side / 4, grip: grip * (1 - balance) },
  ];
}

function cardFrames(shake: Point[], id: string, width: number, height: number, start: CardPose): CardPose[] {
  const pose = { ...start, angle: start.angle * Math.PI / 180 };
  const velocity = { x: 0, y: 0, angle: 0 };
  const momentOfInertia = Math.max(1, (width ** 2 + height ** 2) / 12);
  const contacts = pieceContacts(id, width, height);

  return shake.map((position, index) => {
    if (index > 0) {
      const previous = shake[index - 1];
      const tableX = (position.x - previous.x) / step;
      const tableY = (position.y - previous.y) / step;
      const cos = Math.cos(pose.angle);
      const sin = Math.sin(pose.angle);

      for (const contact of contacts) {
        const x = contact.x * cos - contact.y * sin;
        const y = contact.x * sin + contact.y * cos;
        const slipX = tableX - velocity.x + velocity.angle * y;
        const slipY = tableY - velocity.y - velocity.angle * x;
        const slip = Math.hypot(slipX, slipY);
        if (slip === 0) continue;

        const directionX = slipX / slip;
        const directionY = slipY / slip;
        const lever = x * directionY - y * directionX;
        const stickingImpulse = slip / (1 + lever ** 2 / momentOfInertia);
        const gripLimit = contact.grip * step;
        const impulse = stickingImpulse <= gripLimit ? stickingImpulse : gripLimit * 0.78;

        velocity.x += impulse * directionX;
        velocity.y += impulse * directionY;
        velocity.angle += impulse * lever / momentOfInertia;
      }

      pose.x += velocity.x * step - (position.x - previous.x);
      pose.y += velocity.y * step - (position.y - previous.y);
      pose.angle += velocity.angle * step;
    }

    return {
      x: start.x + (pose.x - start.x) * pieceMotionGain,
      y: start.y + (pose.y - start.y) * pieceMotionGain,
      angle: start.angle + (pose.angle * 180 / Math.PI - start.angle) * pieceMotionGain,
    };
  });
}

function translate({ x, y }: Point) {
  return `${x.toFixed(2)}px ${y.toFixed(2)}px`;
}

/** Shake one shared surface and let each piece grip or slide against it. */
export function nudgeDesk(desk: HTMLElement, previous: Animation[]): Animation[] {
  const cards = Array.from(desk.querySelectorAll<HTMLElement>("[data-desk-piece]"), (element) => {
    const style = getComputedStyle(element);
    const [x = 0, y = 0] = style.translate === "none" ? [] : style.translate.split(" ").map(parseFloat);
    const angle = parseFloat(style.rotate) || 0;
    return {
      element,
      id: element.dataset.deskPiece ?? "",
      start: { x, y, angle },
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  });
  previous.forEach((animation) => animation.cancel());

  const shake = shakeFrames();
  const duration = frameCount * step * 1000;
  return [
    desk.animate(shake.map((position) => ({ translate: translate(position) })), duration),
    ...cards.map(({ element, id, start, width, height }) =>
      element.animate(cardFrames(shake, id, width, height, start).map((pose) => ({
        translate: translate(pose),
        rotate: `${pose.angle.toFixed(2)}deg`,
      })), { duration, fill: "forwards" }),
    ),
  ];
}
