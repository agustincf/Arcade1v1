"use client";

// Tarjeta "Tu perfil" dentro de /my-agents: muestra avatar + nombre actual (o
// "Sin nombre") y permite editarlos firmando con la wallet. Reusa el mismo
// patrón visual que el paso 3 del builder (input de nombre + grilla de avatars).

import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { profileAuthMessage } from "@arcade1v1/game-sdk/auth";
import { AGENT_AVATARS } from "@arcade1v1/strategies";
import { useT } from "@/app/lib/i18n";
import { getProfile, setProfile } from "@/app/lib/arbiter";
import { failureText } from "@/app/lib/errors";
import { useEnsureChain } from "@/app/lib/wallet";

export function ProfileEditor({ address }: { address: string }) {
  const { t } = useT();
  const { signMessageAsync } = useSignMessage();
  const ensureChain = useEnsureChain();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AGENT_AVATARS[0]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Motivo del fallo, visible: guardar fallaba EN SILENCIO y el botón parecía roto.
  const [err, setErr] = useState<{ key: string; vars?: Record<string, string | number> } | null>(
    null,
  );

  useEffect(() => {
    let cancel = false;
    getProfile(address)
      .then((p) => {
        if (cancel || !p) return;
        setName(p.name);
        setAvatar(p.avatar);
      })
      .finally(() => !cancel && setLoaded(true));
    return () => {
      cancel = true;
    };
  }, [address]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setErr(null);
    const ts = Date.now();
    let signature: string;
    try {
      await ensureChain();
      signature = await signMessageAsync({
        message: profileAuthMessage("set", address, ts),
      });
    } catch (e) {
      setErr(failureText("sign", e));
      setSaving(false);
      return;
    }
    try {
      const p = await setProfile({ address, name: trimmed, avatar, signature, ts });
      setName(p.name);
      setAvatar(p.avatar);
      setEditing(false);
    } catch (e) {
      setErr(failureText("server", e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="win mb-4">
      <div className="win-title win-title--cyan">
        <span>{t("profile.title")}</span>
      </div>
      <div className="p-4">
        {!editing ? (
          <div className="flex items-center gap-3">
            <span className="text-3xl">{avatar}</span>
            <span className="flex-1 font-pixel text-xs text-(--color-text)">
              {name.trim() || t("profile.none")}
            </span>
            <button
              onClick={() => setEditing(true)}
              disabled={!loaded}
              className="btn3d btn3d--cyan disabled:opacity-50"
            >
              ✏ {t("profile.edit")}
            </button>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-(--color-muted-2)">
              {t("build.name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder={t("build.namePh")}
                className="mt-2 w-full rounded-md border-2 border-(--color-border) bg-(--color-ink) px-3 py-2 text-base text-(--color-text) outline-none focus:border-(--color-accent)"
              />
            </label>
            <p className="mt-4 text-sm font-medium text-(--color-muted-2)">{t("build.avatar")}</p>
            <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {AGENT_AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`win p-2 text-2xl transition hover:-translate-y-0.5 ${
                    avatar === a ? "!border-(--color-accent)" : ""
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            {err && (
              <p className="mt-3 text-center text-sm text-(--color-lose)">{t(err.key, err.vars)}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
              >
                {saving ? t("profile.saving") : t("profile.save")}
              </button>
              <button onClick={() => setEditing(false)} className="btn3d btn3d--cyan flex-1">
                {t("build.prev")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
