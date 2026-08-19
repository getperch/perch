import { createSubjects } from "@openauthjs/openauth";
import { z } from "zod";

/**
 * Minted into every access token by auth-issuer.ts, read back out by authorizer.ts. `userID` is
 * a real workspace Member id (not a raw auth-provider id) — resolveOrBootstrapMember() links the
 * two at sign-in time, so every downstream ctx.actorId is directly a Person.id.
 */
export const subjects = createSubjects({
  user: z.object({
    userID: z.string(),
    workspaceID: z.string(),
  }),
});
