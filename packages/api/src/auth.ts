/**
 * User authentication — register, login, JWT verification.
 *
 * Users stored in data/users.json. Passwords hashed with bcrypt.
 * Sessions are stateless JWT tokens (24h expiry).
 */

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createStore } from "./persistence.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
}

// ─── Config ─────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("FATAL: JWT_SECRET environment variable is required in production.");
  process.exit(1);
}
const SECRET = JWT_SECRET || "webmap-dev-secret-DO-NOT-USE-IN-PROD";
const JWT_EXPIRY = "24h";
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// ─── Store ──────────────────────────────────────────────────────────

const usersStore = createStore<Record<string, User>>("users", {});

export async function loadUsers(): Promise<void> {
  await usersStore.load();
}

function findByEmail(email: string): User | undefined {
  const lower = email.toLowerCase();
  return Object.values(usersStore.data).find((u) => u.email === lower);
}

// ─── Register ───────────────────────────────────────────────────────

export async function registerUser(
  email: string,
  password: string
): Promise<{ user: User; token: string } | { error: string }> {
  const lower = email.toLowerCase().trim();

  if (!lower || !lower.includes("@")) {
    return { error: "Valid email required" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (findByEmail(lower)) {
    return { error: "Email already registered" };
  }

  const user: User = {
    id: randomUUID(),
    email: lower,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    createdAt: new Date().toISOString(),
  };

  usersStore.data[user.id] = user;
  await usersStore.save();

  const token = signToken(user);
  return { user, token };
}

// ─── Login ──────────────────────────────────────────────────────────

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: User; token: string } | { error: string }> {
  const lower = email.toLowerCase().trim();
  const user = findByEmail(lower);

  if (!user) {
    return { error: "Invalid email or password" };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return { error: "Invalid email or password" };
  }

  const token = signToken(user);
  return { user, token };
}

// ─── JWT ────────────────────────────────────────────────────────────

function signToken(user: User): string {
  const payload: JWTPayload = { userId: user.id, email: user.email };
  return jwt.sign(payload, SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Extract userId from an Authorization: Bearer <jwt> header.
 * Returns null if missing/invalid.
 */
export function getUserIdFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  return payload?.userId ?? null;
}
