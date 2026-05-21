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
      const isPublicPath = ["/login", "/register", "/forgot-password", "/api/auth"].some((p) =>
        nextUrl.pathname.startsWith(p)
      );

      if (isPublicPath) return true;
      if (isLoggedIn) return true;

      // Return 401 JSON for API routes instead of a redirect to /login
      if (nextUrl.pathname.startsWith("/api/")) {
        return new Response(
          JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return false;
    },
  },
};
