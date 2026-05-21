import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';

import { prisma } from '@/server/db';

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [],
  session: { strategy: 'database' },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
