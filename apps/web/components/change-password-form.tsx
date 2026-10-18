"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { signOut } from "next-auth/react";
import { type FormEvent, useState } from "react";

import { useLanguage } from "./language-provider";

export function ChangePasswordForm() {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t("auth.passwordChangeFailed"));
      }
      await signOut({ redirect: false });
      window.location.assign("/login");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("auth.passwordChangeFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <KeyRound size={20} />
          </span>
          <span>
            <strong>Scholar</strong>
            <small>{t("app.tagline")}</small>
          </span>
        </div>
        <div className="auth-heading">
          <h1>{t("auth.changePasswordTitle")}</h1>
          <p>{t("auth.passwordChanged")}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            {t("auth.currentPassword")}
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label>
            {t("auth.newPassword")}
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label>
            {t("auth.confirmPassword")}
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : null}
            {t("auth.changePassword")}
          </button>
        </form>
      </section>
    </main>
  );
}
