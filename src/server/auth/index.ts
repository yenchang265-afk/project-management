// Auth.js v5 wiring.
//
// Strategy: JWT (required for Credentials), PrismaAdapter for User/Account/
// VerificationToken storage. We support two sign-in methods:
//   1. Credentials (email + password)         — verifyCredentials() in the service.
//   2. Nodemailer magic link (Mailpit in dev) — Auth.js's built-in provider.
//
// The session callback enriches the token with `userId` and `role` so RBAC
// guards can short-circuit without hitting the DB on every request.

import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import type { Role } from '@prisma/client';

import { prisma } from '@/server/db';
import { createAuthService } from '@/server/services/auth';

const smtpHost = process.env.SMTP_HOST ?? 'localhost';
const smtpPort = Number(process.env.SMTP_PORT ?? '1025');
const fromAddress = process.env.SMTP_FROM ?? 'no-reply@project-mgmt.local';

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const svc = createAuthService({ prisma });
        try {
          const user = await svc.verifyCredentials({
            email: String(credentials.email),
            password: String(credentials.password),
          });
          return { id: user.id, email: user.email, name: user.name };
        } catch {
          return null;
        }
      },
    }),
    Nodemailer({
      server: {
        host: smtpHost,
        port: smtpPort,
        // Mailpit (dev) has no auth; in prod set SMTP_USER / SMTP_PASS env.
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      },
      from: fromAddress,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        // Resolve role at sign-in time so the JWT carries it.
        const svc = createAuthService({ prisma });
        token.role = await svc.getMembershipRole(user.id);
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.userId && session.user) {
        session.user.id = token.userId as string;
        session.user.role = (token.role as Role) ?? 'MEMBER';
      }
      return session;
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
