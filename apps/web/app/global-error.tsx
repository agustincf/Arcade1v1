"use client";

// Red de seguridad de ÚLTIMO recurso: atrapa errores lanzados por el layout
// raíz mismo (donde error.tsx no llega). Reemplaza al <html> entero, así que
// no puede usar el i18n ni los estilos del layout — texto fijo y estilo inline.

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050210",
          color: "#e8e6f0",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 48 }}>💾💥</div>
          <h1 style={{ fontSize: 18, marginTop: 12 }}>Something went wrong / Algo salió mal</h1>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 24px",
              fontSize: 14,
              cursor: "pointer",
              background: "#e5484d",
              color: "#fff",
              border: "none",
              borderRadius: 8,
            }}
          >
            Retry / Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
