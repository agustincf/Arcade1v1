import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not available in your region | Arcade1v1",
  robots: { index: false, follow: false },
};

export default function UnavailablePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="text-6xl">🌍</div>
      <h1 className="font-pixel mt-4 text-lg text-[--color-gold]">Not available here</h1>
      <p className="mt-4 text-lg leading-relaxed text-[--color-muted]">
        Arcade1v1 is not available in your region. Access to skill-gaming for value is restricted in
        your jurisdiction.
      </p>
      <p className="mt-3 text-base leading-relaxed text-[--color-muted-3]">
        If you believe this is a mistake, please get in touch.
      </p>
    </div>
  );
}
