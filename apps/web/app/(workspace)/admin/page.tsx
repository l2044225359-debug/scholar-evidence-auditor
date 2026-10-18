import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AdminView } from "@/components/admin-view";

export default async function AdminPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    redirect("/");
  }
  return <AdminView />;
}
