export default function Home() {
  return (
    <div className="pad">
      <div className="ph">
        <div className="ph-row">
          <h1>SIBA 3.0</h1>
        </div>
        <p className="ph-sub">
          Design system terpasang. Modul akan dibangun satu per satu.
        </p>
      </div>

      <div className="card">
        <div className="card-h">
          <div className="ct">
            <h3>Status</h3>
            <p>Verifikasi token desain dari mockup</p>
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", gap: 8 }}>
          <span className="bdg s-ok">Aktif</span>
          <span className="bdg s-warn">Draft</span>
          <span className="bdg s-info">Diajukan</span>
          <span className="mono">Rp 1.250.000.000</span>
        </div>
      </div>
    </div>
  );
}
