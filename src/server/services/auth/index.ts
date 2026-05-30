// Identity/auth domain service. Keep all password + token handling here so
// route handlers stay thin and the rules are unit-testable without a DB.

import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { PrismaClient, Role, User } from '@prisma/client';

import { AuthError } from '@/lib/errors';
import { publish, type DomainEvent } from '@/server/events/bus';

export { AuthError } from '@/lib/errors';

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_TOKEN_BYTES = 32;

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().trim().min(1).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const resetInputSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetInput = z.infer<typeof resetInputSchema>;

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AuthError('invalid_input', result.error.issues[0]?.message, result.error.flatten());
  }
  return result.data;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Token comparison safety note: the raw token is hashed with SHA-256 before
// being stored or compared. Any timing information observable via a WHERE
// clause lookup therefore reveals only bits of the SHA-256 digest; recovering
// the original token from such information is computationally infeasible.

export type AuthServiceDeps = {
  prisma: PrismaClient;
  /** Override the event sink (tests). Defaults to the global bus. */
  onEvent?: (event: DomainEvent) => void | Promise<void>;
  /** Override the clock for deterministic tests. */
  now?: () => Date;
};

export function createAuthService(deps: AuthServiceDeps) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const emit = async (event: DomainEvent) => {
    if (deps.onEvent) await deps.onEvent(event);
    else await publish(event);
  };

  async function register(input: RegisterInput): Promise<User> {
    const data = parseOrThrow(registerInputSchema, input);
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    try {
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          name: data.name ?? null,
          passwordHash,
        },
      });
      await emit({ type: 'auth.registered', payload: { userId: user.id, email: user.email } });
      return user;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AuthError('email_taken', 'Email already in use');
      }
      throw err;
    }
  }

  async function verifyCredentials(input: Credentials): Promise<User> {
    const data = parseOrThrow(credentialsSchema, input);
    const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!user || !user.passwordHash) {
      throw new AuthError('invalid_credentials');
    }
    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) {
      throw new AuthError('invalid_credentials');
    }
    return user;
  }

  async function createPasswordResetToken(email: string): Promise<string | null> {
    const normalized = z.string().email().safeParse(email);
    if (!normalized.success) return null;
    const user = await prisma.user.findUnique({
      where: { email: normalized.data.toLowerCase() },
    });
    if (!user) return null;
    const token = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(token);
    const expires = new Date(now().getTime() + RESET_TOKEN_TTL_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: tokenHash,
        passwordResetExpires: expires,
      },
    });
    await emit({
      type: 'auth.password_reset_requested',
      payload: { userId: user.id, email: user.email, token },
    });
    return token;
  }

  async function resetPassword(input: ResetInput): Promise<User> {
    const data = parseOrThrow(resetInputSchema, input);
    const tokenHash = hashToken(data.token);

    // Validate existence and expiry first so we can give a meaningful error.
    const candidate = await prisma.user.findFirst({
      where: { passwordResetToken: tokenHash },
    });
    if (!candidate || !candidate.passwordResetToken || !candidate.passwordResetExpires) {
      throw new AuthError('invalid_token', 'Reset token is invalid or expired');
    }
    if (candidate.passwordResetExpires.getTime() < now().getTime()) {
      throw new AuthError('invalid_token', 'Reset token has expired');
    }

    const passwordHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);

    // Atomic claim: include the token in the WHERE clause so only one of two
    // concurrent reset requests can succeed — the second finds token=NULL.
    const { count } = await prisma.user.updateMany({
      where: { id: candidate.id, passwordResetToken: tokenHash },
      data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
    });
    if (count === 0) {
      throw new AuthError('invalid_token', 'Reset token is invalid or expired');
    }

    // Invalidate all existing sessions so prior sessions (including any that
    // were hijacked) cannot be used after a password reset.
    await prisma.session.deleteMany({ where: { userId: candidate.id } });

    return {
      ...candidate,
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    } as User;
  }

  async function getMembershipRole(userId: string): Promise<Role> {
    const membership = await prisma.orgMembership.findUnique({ where: { userId } });
    return membership?.role ?? 'MEMBER';
  }

  return {
    register,
    verifyCredentials,
    createPasswordResetToken,
    resetPassword,
    getMembershipRole,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
