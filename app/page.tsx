// Root redirect. Authenticated users land on /dashboard; everyone else on
// /login. Server component so the redirect happens before any HTML ships.

import { redirect } from 'next/navigation';

import { auth } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<never> {
  const session = await auth();
  redirect(session ? '/dashboard' : '/login');
}
