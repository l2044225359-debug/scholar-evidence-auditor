"use client";

import {
  BookOpen,
  FileText,
  Languages,
  Library,
  LogOut,
  Network,
  Server,
  ScanSearch,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { MessageKey } from "@/lib/i18n";

import { useLanguage } from "./language-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLanguage();
  const { data: session } = useSession();
  const navigation: Array<{
    href: string;
    labelKey: MessageKey;
    icon: typeof BookOpen;
  }> = [
    { href: "/", labelKey: "nav.workspace", icon: BookOpen },
    { href: "/documents", labelKey: "nav.documents", icon: Library },
    { href: "/citations", labelKey: "nav.citations", icon: Network },
    { href: "/audit", labelKey: "nav.audit", icon: ScanSearch },
    { href: "/system", labelKey: "nav.system", icon: Server },
  ];
  if (session?.user?.role === "admin") {
    navigation.splice(4, 0, {
      href: "/admin",
      labelKey: "nav.admin",
      icon: ShieldCheck,
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <FileText size={18} strokeWidth={2.2} />
          </span>
          <span>
            <strong>Scholar</strong>
            <small>{t("app.tagline")}</small>
          </span>
        </Link>

        <nav className="main-nav" aria-label={t("nav.primary")}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "nav-item active" : "nav-item"}
              >
                <Icon size={17} strokeWidth={2} />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="account-summary">
          <UserCircle size={17} />
          <span>
            <strong>{session?.user?.name ?? "User"}</strong>
            <small>
              {session?.user?.role === "admin"
                ? t("auth.roleAdmin")
                : t("auth.roleUser")}
            </small>
          </span>
          <button
            type="button"
            aria-label={t("auth.logout")}
            title={t("auth.logout")}
            onClick={async () => {
              await signOut({ redirect: false });
              window.location.assign("/login");
            }}
          >
            <LogOut size={14} />
          </button>
        </div>

        <div className="language-switch" aria-label={t("app.language")}>
          <Languages size={14} />
          <button
            type="button"
            className={locale === "zh" ? "active" : ""}
            onClick={() => setLocale("zh")}
          >
            中文
          </button>
          <button
            type="button"
            className={locale === "en" ? "active" : ""}
            onClick={() => setLocale("en")}
          >
            EN
          </button>
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>{t("app.localStack")}</span>
        </div>
      </aside>
      <div className="main-surface">{children}</div>
    </div>
  );
}
