// Ruteo por idioma. No tenía un solo test, y por ese agujero se coló el bug de
// la cookie "en": como el inglés no lleva prefijo, no estaba en LOCALES, así que
// la elección explícita del usuario se ignoraba y el portero lo devolvía a su
// idioma local en cada navegación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLang } from "../proxy";

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
