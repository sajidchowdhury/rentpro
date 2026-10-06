import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/rentData";

// NextAuth options. The credentials provider verifies against the in-memory
// users loaded from the dump's `admin` table (bcrypt $2y$ -> $2b$). In
// production (after migrate:write), swap verifyCredentials to query the
// Postgres `users` table via Prisma — the rest stays the same.
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/" }, // the app gates login on the / route (client-side)
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const user = await verifyCredentials(
          credentials.username,
          credentials.password
        );
        if (!user) return null;
        return {
          id: String(user.id),
          name: user.displayName,
          email: user.username, // store username in email slot
          role: user.role,
          username: user.username,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as any;
        token.uid = u.id;
        token.role = u.role;
        token.username = u.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).role = token.role;
        (session.user as any).username = token.username;
      }
      return session;
    },
  },
};
