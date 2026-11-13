import { clerkMiddleware } from "@clerk/nextjs/server";

// Signing in is optional: nothing is protected here. Routes that need a user check auth() themselves.
export default clerkMiddleware({
  // Reject sessions issued for other frontend origins.
  authorizedParties: [new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").origin],
});

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|mjs|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
