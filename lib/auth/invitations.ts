import { appOrigin, staffDatabase } from "./session";

export async function sendStaffInvitation(email: string, db = staffDatabase()) {
  const redirectTo = `${appOrigin()}/auth/accept`;
  const result = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
  // A person who already verified their address can still have a pending staff
  // invitation (for example after closing password setup). Send a recovery link
  // instead; the same pending/expiry checks still gate activation on the server.
  if (result.error && ["email_exists", "user_already_exists"].includes(result.error.code))
    return db.auth.resetPasswordForEmail(email, { redirectTo });
  return result;
}
