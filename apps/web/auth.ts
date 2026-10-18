import { verify } from "@node-rs/argon2";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { getUserByUsername } from "@/lib/db";

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Username and password",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = getUserByUsername(parsed.data.username);
        if (!user || !user.active) return null;

        const valid = await verify(
          user.password_hash,
          parsed.data.password,
        ).catch(() => false);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          mustChangePassword: Boolean(user.must_change_password),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id ?? "";
        token.role = user.role;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as "admin" | "user";
        session.user.mustChangePassword = Boolean(
          token.mustChangePassword,
        );
      }
      return session;
    },
  },
});
