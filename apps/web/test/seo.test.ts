// Garantías de SEO y de la tarjeta para compartir. Cada una cubre un error que
// estuvo en producción:
// - /es y /fr salían con título y descripción en inglés (solo la home cambiaba).
// - Descripciones de hasta 285 caracteres: Google las corta en ~160 y LinkedIn
//   las muestra a medias.
// - og:url apuntaba a la URL inglesa, y en una sala de Aleph a /aleph: LinkedIn
//   toma og:url como la URL del link, así que compartir una sala abría la portada.
// - El llms.txt enlazaba páginas que había que chequear a mano.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LANGS } from "../app/lib/i18n-dict";
import { MARCA, META, SITE, pageMeta } from "../app/lib/seo";
import { GAME_SEO, PAGE_SEO, textoDeSala, type Texto } from "../app/lib/seo-pages";
import { ES_ID_DE_SALA } from "../app/lib/aleph-server";
import { GAMES } from "../app/lib/games";
import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { fr } from "../app/lib/i18n/fr.js";
import sitemap from "../app/sitemap";

function revisar(donde: string, t: Texto, conMarca = true) {
  const titulo = conMarca ? t.title + MARCA : t.title;
  assert.ok(titulo.length <= 65, `${donde}: título de ${titulo.length} (${titulo})`);
  assert.ok(
    t.description.length >= 70 && t.description.length <= 160,
    `${donde}: descripción de ${t.description.length}`,
  );
}

test("cada página del catálogo tiene título y descripción en los 3 idiomas, en largo", () => {
  for (const [page, porIdioma] of Object.entries(PAGE_SEO)) {
    for (const lang of LANGS) revisar(`${page}/${lang}`, porIdioma[lang]);
  }
});

test("cada juego en vivo tiene su SEO en los 3 idiomas, en largo", () => {
  for (const g of GAMES.filter((g) => g.status === "live")) {
    assert.ok(GAME_SEO[g.id], `${g.id} sin SEO`);
    for (const lang of LANGS) revisar(`game/${g.id}/${lang}`, GAME_SEO[g.id][lang]);
  }
});

test("la home: descripción de hasta 160 en los 3 idiomas", () => {
  for (const lang of LANGS) revisar(`home/${lang}`, META[lang], false);
});

test("pageMeta: og:url es la URL de la página en su idioma (la del canonical)", () => {
  const es_ = pageMeta({ ...PAGE_SEO.aleph.es, path: "/aleph", lang: "es" });
  assert.equal(es_.openGraph.url, `${SITE.url}/es/aleph`);
  assert.equal(es_.openGraph.locale, "es_ES");
  assert.deepEqual(es_.openGraph.alternateLocale, ["en_US", "fr_FR"]);

  // El título sale absoluto y con la marca: el template del layout raíz no
  // llega a los segmentos anidados (salas, replays).
  assert.deepEqual(es_.title, { absolute: `${PAGE_SEO.aleph.es.title}${MARCA}` });
  assert.equal(es_.openGraph.title, PAGE_SEO.aleph.es.title);

  const en_ = pageMeta({ ...PAGE_SEO.aleph.en, path: "/aleph", lang: "en" });
  assert.equal(en_.openGraph.url, `${SITE.url}/aleph`);
  // Sin idioma, inglés (el comportamiento de antes para quien no lo pase).
  assert.equal(pageMeta({ ...PAGE_SEO.aleph.en, path: "/aleph" }).openGraph.url, en_.openGraph.url);
  // Sin path, la home de ese idioma.
  assert.equal(pageMeta({ ...PAGE_SEO.aleph.fr, lang: "fr" }).openGraph.url, `${SITE.url}/fr`);
});

test("pageMeta: la imagen va con medidas y alt, en og y en twitter", () => {
  const m = pageMeta({ ...PAGE_SEO.build.en, path: "/build", image: "/x/opengraph-image" });
  const [og] = m.openGraph.images;
  assert.equal(og.url, "/x/opengraph-image");
  assert.equal(og.width, 1200);
  assert.equal(og.height, 630);
  assert.ok(og.alt.length > 0);
  assert.deepEqual(m.twitter.images, m.openGraph.images);
  assert.equal(m.twitter.card, "summary_large_image");
});

const ROOM = "0x00a4b166fe557a88ad09394ced405d60925eb9b12a0432316e312146b9478cc7";
const asientos = (n: number) => Array.from({ length: n }, () => ({}));

test("textoDeSala: cada estado dice lo suyo y entra en el largo", () => {
  for (const lang of LANGS) {
    const liquidada = textoDeSala(
      { roomId: ROOM, status: "settled", seats: asientos(8), results: asientos(12) },
      lang,
    );
    assert.match(liquidada.title, /0x00a4b1…/);
    assert.match(liquidada.title, /8/);
    assert.match(liquidada.description, /12/);
    revisar(`sala liquidada/${lang}`, liquidada);

    // La etapa se muestra desde 1: el motor la cuenta desde 0.
    const enJuego = textoDeSala(
      { roomId: ROOM, status: "playing", seats: asientos(4), stage: { index: 2 } },
      lang,
    );
    assert.match(enJuego.description, /3/);
    revisar(`sala en juego/${lang}`, enJuego);

    const lobby = textoDeSala({ roomId: ROOM, status: "lobby", seats: asientos(1) }, lang);
    revisar(`sala en lobby/${lang}`, lobby);

    // Sin sala (árbitro caído) o disuelta: la tarjeta de la portada de Aleph.
    assert.deepEqual(textoDeSala(null, lang), PAGE_SEO.aleph[lang]);
    assert.deepEqual(
      textoDeSala({ roomId: ROOM, status: "dissolved", seats: asientos(3) }, lang),
      PAGE_SEO.aleph[lang],
    );
  }
});

test("el id de sala se valida antes de armar la URL del árbitro", () => {
  assert.ok(ES_ID_DE_SALA.test(ROOM));
  assert.ok(ES_ID_DE_SALA.test(ROOM.toUpperCase().replace("0X", "0x")));
  for (const malo of ["", "0x123", `${ROOM}00`, "../health", `${ROOM}/log`, ROOM.slice(2)]) {
    assert.ok(!ES_ID_DE_SALA.test(malo), `aceptó ${malo}`);
  }
});

test("el FAQ visible (y su FAQPage) tiene las 8 preguntas en los 3 idiomas", () => {
  for (const [lang, dict] of Object.entries({ en, es, fr })) {
    for (let n = 1; n <= 8; n++) {
      assert.ok(dict[`faq.q${n}`], `${lang}: falta faq.q${n}`);
      assert.ok(dict[`faq.a${n}`], `${lang}: falta faq.a${n}`);
    }
  }
});

test("llms.txt: cada página del sitio que enlaza está en el sitemap", () => {
  const llms = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
  const enSitemap = new Set(sitemap().map((e) => e.url.replace(SITE.url, "") || "/"));
  const enlazadas = [...llms.matchAll(/https:\/\/arcade1v1\.com(\/[^\s)]*)?/g)].map(
    (m) => (m[1] ?? "/").replace(/[.,]$/, "") || "/",
  );
  assert.ok(enlazadas.length > 5);
  for (const p of enlazadas) {
    if (p === "/llms.txt") continue;
    assert.ok(enSitemap.has(p), `llms.txt enlaza ${p}, que no está en el sitemap`);
  }
  // Lo que un agente tiene que saber antes de pedir partida.
  assert.match(llms, /## What's new/);
  assert.match(llms, /stake 0/);
});
