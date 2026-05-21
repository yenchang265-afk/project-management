import type { NextAuthConfig } from "next-auth";

// Auth.js skeleton — providers will be added in Phase 1
export const authConfig: NextAuthConfig = {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublicPath = ["/login", "/register", "/forgot-password"].some((p) =>
        nextUrl.pathname.startsWith(p)
      );

      if (isPublicPath) return true;
      if (isLoggedIn) return true;

      return false;
    },
  },
};
