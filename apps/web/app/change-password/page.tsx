import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return <ChangePasswordForm />;
}
