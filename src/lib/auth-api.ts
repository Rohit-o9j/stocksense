/**
 * Authentication server functions.
 *
 * Passwords are verified against the PBKDF2 hashes in the `users` table and the
 * signed-in user id is kept in an encrypted cookie. Nothing here trusts input
 * from the client beyond what the validators allow.
 */
import { createServerFn } from "@tanstack/react-start";
import { clearSession, useSession } from "@tanstack/react-start/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { passwordResetOtps, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../server/password";
import { currentUser, loadUser, requireUser, type SessionUser } from "./guards";
import { sessionConfig, type SessionPayload } from "./session";

/** Re-exported so client code has one place to import the user shape from. */
export type AuthUser = SessionUser;

/** Deliberately vague so the form cannot be used to discover which emails exist. */
const BAD_CREDENTIALS = "That email and password combination does not match an account.";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/**
 * True when there is no mail provider wired up. In that mode the reset code is
 * returned to the caller so the flow is testable locally.
 *
 * SECURITY: this must never be true in production — it would hand a password
 * reset code to anyone who knows an email address.
 */
const EXPOSE_OTP = process.env["NODE_ENV"] !== "production";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUser | null> => currentUser(),
);

export const signOut = createServerFn({ method: "POST" }).handler(async (): Promise<void> => {
  await clearSession(sessionConfig);
});

// ---------------------------------------------------------------------------
// Sign in / sign up
// ---------------------------------------------------------------------------

const signInInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => signInInput.parse(input))
  .handler(async ({ data }): Promise<AuthUser> => {
    const email = normalizeEmail(data.email);

    const [row] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!row) {
      // Spend comparable time on a miss so response timing does not reveal
      // whether the address exists.
      await hashPassword(data.password);
      throw new Error(BAD_CREDENTIALS);
    }

    const ok = await verifyPassword(data.password, row.passwordHash);
    if (!ok) throw new Error(BAD_CREDENTIALS);

    const session = await useSession<SessionPayload>(sessionConfig);
    await session.update({ userId: row.id });

    const user = await loadUser(row.id);
    if (!user) throw new Error(BAD_CREDENTIALS);
    return user;
  });

const signUpInput = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.string().email(),
  password: z.string().min(8, "Use at least 8 characters"),
});

export const signUp = createServerFn({ method: "POST" })
  .validator((input: unknown) => signUpInput.parse(input))
  .handler(async ({ data }): Promise<AuthUser> => {
    const email = normalizeEmail(data.email);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) throw new Error("An account already exists for that email address.");

    /**
     * Role is assigned here, never accepted from the client — otherwise anyone
     * could register with elevated access. The very first account bootstraps as
     * Admin so a fresh install is administrable; everyone after starts as
     * Warehouse Staff and must be promoted from the admin dashboard.
     */
    const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
    const role = anyUser ? "Warehouse Staff" : "Admin";

    const [created] = await db
      .insert(users)
      .values({
        name: data.name.trim(),
        email,
        passwordHash: await hashPassword(data.password),
        role,
      })
      .returning({ id: users.id });

    if (!created) throw new Error("Could not create the account. Try again.");

    const session = await useSession<SessionPayload>(sessionConfig);
    await session.update({ userId: created.id });

    const user = await loadUser(created.id);
    if (!user) throw new Error("Could not load the new account.");
    return user;
  });

// ---------------------------------------------------------------------------
// Password reset by one-time code
// ---------------------------------------------------------------------------

const emailInput = z.object({ email: z.string().email() });

export type OtpRequestResult = {
  /** Always true, whether or not the address has an account. */
  sent: true;
  /** Present only outside production, because no mail provider is configured. */
  devCode?: string;
};

export const requestPasswordOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => emailInput.parse(input))
  .handler(async ({ data }): Promise<OtpRequestResult> => {
    const email = normalizeEmail(data.email);

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Report success even for unknown addresses so the form cannot enumerate accounts.
    if (!user) return { sent: true };

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)
      .padStart(6, "0")
      .slice(-6);

    await db.insert(passwordResetOtps).values({
      userId: user.id,
      codeHash: await hashPassword(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    if (EXPOSE_OTP) {
      console.log(`[auth] password reset code for ${email}: ${code}`);
      return { sent: true, devCode: code };
    }

    // TODO: hand `code` to a mail provider once one is configured.
    return { sent: true };
  });

const resetInput = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6 digit code"),
  password: z.string().min(8, "Use at least 8 characters"),
});

export const resetPasswordWithOtp = createServerFn({ method: "POST" })
  .validator((input: unknown) => resetInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    const email = normalizeEmail(data.email);

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) throw new Error("That code is not valid or has expired.");

    const candidates = await db
      .select({
        id: passwordResetOtps.id,
        codeHash: passwordResetOtps.codeHash,
        attempts: passwordResetOtps.attempts,
      })
      .from(passwordResetOtps)
      .where(
        and(
          eq(passwordResetOtps.userId, user.id),
          isNull(passwordResetOtps.consumedAt),
          gt(passwordResetOtps.expiresAt, new Date()),
        ),
      );

    let matched: string | null = null;

    for (const candidate of candidates) {
      if (candidate.attempts >= OTP_MAX_ATTEMPTS) continue;
      if (await verifyPassword(data.code, candidate.codeHash)) {
        matched = candidate.id;
        break;
      }
      await db
        .update(passwordResetOtps)
        .set({ attempts: candidate.attempts + 1 })
        .where(eq(passwordResetOtps.id, candidate.id));
    }

    if (!matched) throw new Error("That code is not valid or has expired.");

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(data.password) })
        .where(eq(users.id, user.id));

      // Burn every outstanding code, not just the one used.
      await tx
        .update(passwordResetOtps)
        .set({ consumedAt: new Date() })
        .where(and(eq(passwordResetOtps.userId, user.id), isNull(passwordResetOtps.consumedAt)));
    });
  });

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Resolves the signed-in user id or refuses. Every profile mutation uses this. */
async function requireUserId(): Promise<string> {
  const user = await requireUser();
  return user.id;
}

const profileInput = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  lowStockAlerts: z.boolean(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) => profileInput.parse(input))
  .handler(async ({ data }): Promise<AuthUser> => {
    const userId = await requireUserId();

    await db
      .update(users)
      .set({ name: data.name.trim(), lowStockAlerts: data.lowStockAlerts })
      .where(eq(users.id, userId));

    const user = await loadUser(userId);
    if (!user) throw new Error("Your account could not be loaded.");
    return user;
  });

const changePasswordInput = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "Use at least 8 characters"),
});

export const changePassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => changePasswordInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    const userId = await requireUserId();

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) throw new Error("Your account could not be loaded.");

    // Never let a stolen session change a password without knowing the old one.
    const ok = await verifyPassword(data.currentPassword, row.passwordHash);
    if (!ok) throw new Error("Your current password is not correct.");

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(data.newPassword) })
      .where(eq(users.id, userId));
  });
