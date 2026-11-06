import type { PostDelivery, PostPlatform } from "./types";

/** The brief's delivery choice applies to X; LinkedIn always receives one coherent long post. */
export function deliveryForPlatform(platform: PostPlatform, xDelivery: PostDelivery): PostDelivery {
  return platform === "linkedin" ? "long" : xDelivery;
}

export function postCharacterLimit(platform: PostPlatform, delivery: PostDelivery): number {
  return platform === "linkedin" ? 3000 : delivery === "long" ? 25000 : 280;
}
