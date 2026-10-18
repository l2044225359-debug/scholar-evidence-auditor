import { auth } from "@/auth";

export async function requireSession() {
  const session = await auth();
  return session?.user ? session : null;
}

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return null;
  }
  return session;
}
