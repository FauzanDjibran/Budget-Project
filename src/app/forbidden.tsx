import Link from "next/link";

/**
 * The root refusal boundary, for a `forbidden()` raised outside the application
 * shell. Everything inside the shell is answered by `(app)/forbidden.tsx`,
 * which keeps the navigation; this one stands alone and only offers a way back.
 */
export default function Forbidden() {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1 className="auth-h">Akses ditolak</h1>
        <p className="auth-sub">
          Anda tidak memiliki akses ke halaman ini. Hubungi administrator jika
          Anda memerlukannya.
        </p>
        <Link className="btn primary auth-btn" href="/">
          Kembali
        </Link>
      </div>
    </div>
  );
}
