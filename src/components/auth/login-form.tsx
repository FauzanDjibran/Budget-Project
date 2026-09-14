"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { login } from "@/app/actions/auth";

/**
 * The sign-in screen.
 *
 * It reports one message for every failure — wrong password, unknown address,
 * deactivated account — so the form cannot be used to discover which accounts
 * exist. The distinction is made server-side and deliberately not surfaced.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await login(email, password);
    if (!result.ok) {
      setError(result.message ?? "Tidak dapat masuk.");
      setPassword("");
      setBusy(false);
      return;
    }

    // A full refresh, so the shell re-renders with the new session's menu.
    router.replace(next ?? "/");
    router.refresh();
  };

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <div className="brand-mark">S3</div>
        <div>
          <div className="auth-title">SIBA</div>
          <div className="auth-ver">3.0</div>
        </div>
      </div>

      <h1 className="auth-h">Masuk ke SIBA</h1>
      <p className="auth-sub">
        Gunakan akun yang diberikan administrator. Setiap akses di dalam aplikasi
        mengikuti Role yang melekat pada akun Anda.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="fld full">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className={`inp${error ? " bad" : ""}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@siba.app"
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="fld full">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className={`inp${error ? " bad" : ""}`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="err" role="alert">
            <Icon name="warn" size={11} />
            {error}
          </div>
        )}

        <button className="btn primary auth-btn" type="submit" disabled={busy}>
          {busy ? "Memeriksa…" : "Masuk"}
          {!busy && <Icon name="chev" size={15} />}
        </button>
      </form>

      <p className="auth-foot">
        Lupa password atau akun terkunci? Hubungi administrator sistem.
      </p>
    </div>
  );
}
