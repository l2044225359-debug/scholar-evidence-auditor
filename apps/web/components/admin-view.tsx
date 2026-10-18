"use client";

import {
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useLanguage } from "./language-provider";
import styles from "./admin-view.module.css";

type AdminUser = {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  active: number;
  must_change_password: number;
  created_at: string;
};

type Invite = {
  code: string;
  max_uses: number;
  uses: number;
  active: number;
  expires_at: string | null;
  created_at: string;
};

export function AdminView() {
  const { locale, t } = useLanguage();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState(20);
  const [expiresDays, setExpiresDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersResponse, invitesResponse] = await Promise.all([
        fetch("/api/admin/users", {
          cache: "no-store",
          credentials: "include",
        }),
        fetch("/api/admin/invites", {
          cache: "no-store",
          credentials: "include",
        }),
      ]);
      if (!usersResponse.ok || !invitesResponse.ok) {
        throw new Error(t("admin.subtitle"));
      }
      const [usersPayload, invitesPayload] = await Promise.all([
        usersResponse.json(),
        invitesResponse.json(),
      ]);
      setUsers(usersPayload.items ?? []);
      setInvites(invitesPayload.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resetPassword(user: AdminUser) {
    setError("");
    setNotice("");
    const response = await fetch(
      `/api/admin/users/${user.id}/reset-password`,
      { method: "POST", credentials: "include" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? t("auth.passwordChangeFailed"));
      return;
    }
    setNotice(
      `${user.username} · ${t("admin.temporaryPassword")}: ${payload.temporaryPassword}`,
    );
    await load();
  }

  async function toggleUser(user: AdminUser) {
    const response = await fetch(`/api/admin/users/${user.id}/status`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Failed");
      return;
    }
    await load();
  }

  async function createInviteCode() {
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxUses, expiresDays }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed");
      return;
    }
    setNotice(`${t("admin.invites")}: ${payload.code}`);
    await load();
  }

  function dateLabel(value: string | null) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("admin.title")}</h1>
          <p>{t("admin.subtitle")}</p>
        </div>
        <span className="tag accent">
          <ShieldCheck size={13} />
          {t("auth.roleAdmin")}
        </span>
      </header>

      <main className={styles.content}>
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <UserCog size={17} />
              <h2>{t("admin.users")}</h2>
            </div>
            {loading ? <Loader2 className="spin" size={16} /> : null}
          </div>
          <div className={styles.tableShell}>
            <table>
              <thead>
                <tr>
                  <th>{t("admin.username")}</th>
                  <th>{t("admin.role")}</th>
                  <th>{t("admin.status")}</th>
                  <th>{t("admin.created")}</th>
                  <th>{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.length ? (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.username}</strong>
                        <small>{user.email ?? "—"}</small>
                      </td>
                      <td>
                        {user.role === "admin"
                          ? t("auth.roleAdmin")
                          : t("auth.roleUser")}
                      </td>
                      <td>
                        <span
                          className={
                            user.active
                              ? styles.statusActive
                              : styles.statusInactive
                          }
                        >
                          {user.active
                            ? t("admin.active")
                            : t("admin.inactive")}
                        </span>
                        {user.must_change_password ? (
                          <small>{t("admin.temporaryPassword")}</small>
                        ) : null}
                      </td>
                      <td>{dateLabel(user.created_at)}</td>
                      <td>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            onClick={() => void resetPassword(user)}
                          >
                            <KeyRound size={13} />
                            {t("admin.resetPassword")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleUser(user)}
                          >
                            {user.active
                              ? t("admin.disable")
                              : t("admin.enable")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>{t("admin.noUsers")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <KeyRound size={17} />
              <h2>{t("admin.invites")}</h2>
            </div>
            <div className={styles.inviteControls}>
              <label>
                {t("admin.maxUses")}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxUses}
                  onChange={(event) =>
                    setMaxUses(Number(event.target.value))
                  }
                />
              </label>
              <label>
                {t("admin.expiresDays")}
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={expiresDays}
                  onChange={(event) =>
                    setExpiresDays(Number(event.target.value))
                  }
                />
              </label>
              <button
                className="primary-button"
                type="button"
                onClick={() => void createInviteCode()}
              >
                <Plus size={14} />
                {t("admin.createInvite")}
              </button>
            </div>
          </div>
          <div className={styles.tableShell}>
            <table>
              <thead>
                <tr>
                  <th>{t("admin.invites")}</th>
                  <th>{t("admin.uses")}</th>
                  <th>{t("admin.expires")}</th>
                  <th>{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {invites.length ? (
                  invites.map((invite) => (
                    <tr key={invite.code}>
                      <td>
                        <code>{invite.code}</code>
                      </td>
                      <td>
                        {invite.uses} / {invite.max_uses}
                      </td>
                      <td>{dateLabel(invite.expires_at)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard.writeText(invite.code)
                          }
                        >
                          <Copy size={13} />
                          {t("admin.copy")}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>{t("admin.noInvites")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
