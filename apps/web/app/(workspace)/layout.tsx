import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <SessionProvider session={session}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
