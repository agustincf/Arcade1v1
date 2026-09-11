// Ruteo por idioma. No tenía un solo test, y por ese agujero se coló el bug de
// la cookie "en": como el inglés no lleva prefijo, no estaba en LOCALES, así que
// la elección explícita del usuario se ignoraba y el portero lo devolvía a su
// idioma local en cada navegación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLang, config } from "../proxy";
import { localePath, stripLocale } from "../app/lib/localePath";

test("la cookie explícita le gana al idioma del navegador", () => {
  // El caso del bug: navegador en español, el usuario eligió inglés.
  assert.equal(pickLang("en", "es-AR,es;q=0.9"), "en");
  assert.equal(pickLang("en", "fr-FR,fr;q=0.9"), "en");
  assert.equal(pickLang("en", "hi-IN,hi;q=0.9"), "en");
  // Y al revés: navegador en inglés, el usuario eligió español.
  assert.equal(pickLang("es", "en-US,en;q=0.9"), "es");
  assert.equal(pickLang("fr", "en-US,en;q=0.9"), "fr");
  assert.equal(pickLang("hi", "en-US,en;q=0.9"), "hi");
});

test("sin cookie se respeta el idioma del navegador", () => {
  assert.equal(pickLang(undefined, "es-AR,es;q=0.9"), "es");
  assert.equal(pickLang(undefined, "fr-CA,fr;q=0.8"), "fr");
  assert.equal(pickLang(undefined, "hi-IN"), "hi");
  assert.equal(pickLang(undefined, "en-GB,en;q=0.9"), "en");
});

test("un idioma que no servimos cae a inglés", () => {
  assert.equal(pickLang(undefined, "de-DE,de;q=0.9"), "en");
  assert.equal(pickLang(undefined, "pt-BR"), "en");
  assert.equal(pickLang(undefined, null), "en");
  assert.equal(pickLang(undefined, ""), "en");
});

test("una cookie basura no rompe: se ignora y decide el navegador", () => {
  assert.equal(pickLang("klingon", "es-AR"), "es");
  assert.equal(pickLang("", "fr-FR"), "fr");
  assert.equal(pickLang("es-AR", "fr-FR"), "fr", "la cookie guarda el código corto, no el largo");
});

// Las rutas de Aleph son las primeras que se agregaron después de que el ruteo
// por idioma existiera, así que se testea explícitamente que pasan por él: si
// alguien las dejara fuera del matcher del portero, /es/aleph daría 404 y solo
// se notaría en producción, en un idioma que quizá nadie del equipo usa.
// El matcher de Next se evalúa contra el path ENTERO: hay que anclarlo, si no
// el lookahead negativo se saltea con cualquier substring y el test pasa solo.
const MATCHER = new RegExp(`^${config.matcher[0]}$`);

test("las rutas de Aleph pasan por el portero (no están excluidas del matcher)", () => {
  const ROOM = "0x9f2c4d8a1b3e5f70";
  for (const p of ["/aleph", `/aleph/${ROOM}`, "/es/aleph", `/fr/aleph/${ROOM}`]) {
    assert.ok(MATCHER.test(p), `${p} debería pasar por el portero`);
  }
  // Y lo que el portero NO debe tocar sigue afuera (control de que el regex
  // del test es el bueno y no uno que acepta cualquier cosa).
  assert.ok(!MATCHER.test("/llms.txt"));
  assert.ok(!MATCHER.test("/sitemap.xml"));
});

test("localePath prefija las rutas de Aleph y stripLocale las devuelve enteras", () => {
  const ROOM = "0x9f2c4d8a1b3e5f70";
  assert.equal(localePath("en", "/aleph"), "/aleph"); // inglés: sin prefijo
  assert.equal(localePath("es", "/aleph"), "/es/aleph");
  assert.equal(localePath("fr", `/aleph/${ROOM}`), `/fr/aleph/${ROOM}`);
  assert.equal(localePath("hi", `/aleph/${ROOM}`), `/hi/aleph/${ROOM}`);
  // Idempotente: re-prefijar una ruta ya prefijada no la duplica.
  assert.equal(localePath("es", "/es/aleph"), "/es/aleph");
  assert.equal(localePath("en", `/hi/aleph/${ROOM}`), `/aleph/${ROOM}`);
  assert.equal(stripLocale(`/fr/aleph/${ROOM}`), `/aleph/${ROOM}`);
});
