/**
 * Session configuration. Server-only.
 *
 * Uses TanStack Start's session helpers, which store the payload in an
 * encrypted, signed, httpOnly cookie. Only the user id is kept in the cookie —
 * name and role are read from the database on each request, so revoking or
 * demoting a user takes effect immediately rather than when their cookie
 * happens to expire.
 */
import type { SessionConfig } from "@tanstack/react-start/server";

export type SessionPayload = {
  userId: string;
};

const secret = process.env["SESSION_SECRET"];

if (!secret || secret.length < 32) {
  throw new Error(
    "SESSION_SECRET is missing or shorter than 32 characters. Add it to .env — see .env.example.",
  );
}

export const sessionConfig: SessionConfig = {
  name: "stocksense_session",
  password: secret,
  /** Fourteen days. */
  maxAge: 60 * 60 * 24 * 14,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env["NODE_ENV"] === "production",
  },
};
