// El formato de la cuenta regresiva. Chico pero con trampas: 65 s NO es "1:5",
// y un plazo vencido tiene que mostrar 0:00, nunca un número negativo (pasa
// siempre: el árbitro cierra la fase un instante después del plazo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLeft } from "../app/components/Countdown";
import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { hi } from "../app/lib/i18n/hi.js";
import { fr } from "../app/lib/i18n/fr.js";

test("mm:ss con los segundos en dos dígitos", () => {
  assert.equal(formatLeft(65_000), "1:05");
  assert.equal(formatLeft(600_000), "10:00");
  assert.equal(formatLeft(9_000), "0:09");
});

test("un plazo vencido no muestra números negativos", () => {
  assert.equal(formatLeft(0), "0:00");
  assert.equal(formatLeft(-4_000), "0:00");
});

test("los milisegundos sueltos no adelantan el segundo", () => {
  assert.equal(formatLeft(1_999), "0:01");
});

// CountdownIn parte la frase de la clave por "{t}": si algún idioma perdiera
// esa variable, la frase se quedaría sin reloj y nadie se enteraría (no hay
// error, split() simplemente no encuentra nada que partir). Este test es la
// única red para eso.
test("aleph.lobbies.closes y aleph.room.closes traen {t} en los 4 idiomas", () => {
  for (const [lang, dict] of Object.entries({ en, es, hi, fr })) {
    for (const key of ["aleph.lobbies.closes", "aleph.room.closes"]) {
      assert.ok(dict[key]?.includes("{t}"), `${lang}.${key} no tiene {t}: "${dict[key]}"`);
    }
  }
});
