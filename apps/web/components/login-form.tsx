"use client";

import { FileSearch, Languages, Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { type FormEvent, useState } from "react";

import { useLanguage } from "./language-provider";

type Mode = "login" | "register";

export function LoginForm() {
  const { locale, setLocale, t } = useLanguage();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "register") {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            email,
            password,
            confirmPassword,
            inviteCode,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            payload.message ??
              payload.details?.fieldErrors?.username?.[0] ??
              t("auth.registerFailed"),
          );
        }
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setMessage(t("auth.registerSuccess"));
        return;
      }

      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });
      if (result?.error) {
        throw new Error(t("auth.loginFailed"));
      }
      window.location.assign("/");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : mode === "login"
            ? t("auth.loginFailed")
            : t("auth.registerFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-language">
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

      <section className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <FileSearch size={20} />
          </span>
          <span>
            <strong>Scholar</strong>
            <small>{t("app.tagline")}</small>
          </span>
        </div>

        <div className="auth-heading">
          <h1>
            {mode === "login"
              ? t("auth.loginTitle")
              : t("auth.registerTitle")}
          </h1>
          <p>
            {mode === "login"
              ? t("auth.loginSubtitle")
              : t("auth.registerSubtitle")}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            {t("auth.username")}
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          {mode === "register" ? (
            <>
              <label>
                {t("auth.emailOptional")}
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                {t("auth.inviteCode")}
                <input
                  autoComplete="one-time-code"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required
                />
              </label>
            </>
          ) : null}

          <label>
            {t("auth.password")}
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {mode === "register" ? (
            <label>
              {t("auth.confirmPassword")}
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                required
              />
            </label>
          ) : null}

          {error ? <div className="auth-error">{error}</div> : null}
          {message ? <div className="auth-success">{message}</div> : null}

          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : null}
            {mode === "login" ? t("auth.login") : t("auth.register")}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
            setMessage("");
          }}
        >
          {mode === "login"
            ? t("auth.needAccount")
            : t("auth.haveAccount")}
        </button>
      </section>
    </main>
  );
}
