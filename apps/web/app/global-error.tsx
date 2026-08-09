"use client";

// Red de seguridad de ÚLTIMO recurso: atrapa errores lanzados por el layout
// raíz mismo (donde error.tsx no llega). Reemplaza al <html> entero, así que
// no puede usar el i18n ni los estilos del layout — estilo inline y las cuatro
// traducciones acá adentro, igual que hace unavailable/page.tsx.
//
// Antes decía "Something went wrong / Algo salió mal": el francés y el hindi
// quedaban afuera justo en la pantalla donde el usuario ya está perdido.

const TEXTOS = {
  en: { title: "Something went wrong", retry: "Retry" },
  es: { title: "Algo salió mal", retry: "Reintentar" },
  fr: { title: "Une erreur est survenue", retry: "Réessayer" },
  hi: { title: "कुछ गड़बड़ हो गई", retry: "फिर से कोशिश करें" },
} as const;

/** El idioma del navegador, leído sin provider (acá no hay contexto de React
 *  del layout: este componente ES el layout). Cae a inglés ante cualquier duda. */
function idiomaDelNavegador(): keyof typeof TEXTOS {
  if (typeof navigator === "undefined") return "en";
  const corto = (navigator.language || "en").slice(0, 2).toLowerCase();
  return corto in TEXTOS ? (corto as keyof typeof TEXTOS) : "en";
}

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lang = idiomaDelNavegador();
  const txt = TEXTOS[lang];
  return (
    <html lang={lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#15111b",
          color: "#f0ece1",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 48 }}>💾💥</div>
          <h1 style={{ fontSize: 18, marginTop: 12 }}>{txt.title}</h1>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 24px",
              fontSize: 14,
              cursor: "pointer",
              background: "#e8845e",
              color: "#2a1a10",
              border: "none",
              borderRadius: 8,
            }}
          >
            {txt.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
