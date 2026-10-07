import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials, setActiveOrg } from "@/lib/rentData";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
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
        // set the active org to the user's org so they see their own data
        setActiveOrg(user.orgId);
        return {
          id: user.id,
          name: user.displayName,
          email: user.username,
          role: user.role,
          username: user.username,
          orgId: user.orgId,
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
        token.orgId = u.orgId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).role = token.role;
        (session.user as any).username = token.username;
        (session.user as any).orgId = token.orgId;
      }
      return session;
    },
  },
};
