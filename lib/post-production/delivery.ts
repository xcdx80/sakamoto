import type { PostDelivery, PostPlatform } from "./types";

/** The brief's delivery choice applies to X; LinkedIn always receives one coherent long post. */
export function deliveryForPlatform(platform: PostPlatform, xDelivery: PostDelivery): PostDelivery {
  return platform === "linkedin" ? "long" : xDelivery;
}

export function postCharacterLimit(platform: PostPlatform, delivery: PostDelivery): number {
  return platform === "linkedin" ? 3000 : delivery === "long" ? 25000 : 280;
}

/** Generation packaging is authoritative even when a framework suggests another format. */
export function postDeliveryContract(platform: PostPlatform, xDelivery: PostDelivery) {
  const delivery = deliveryForPlatform(platform, xDelivery);
  return { delivery, minPosts: delivery === "thread" ? 2 : 1, maxPosts: delivery === "thread" ? 30 : 1,
    maxCharactersPerPost: Math.min(15000, postCharacterLimit(platform, delivery)) };
}
