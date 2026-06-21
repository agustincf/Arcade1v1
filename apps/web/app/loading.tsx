export default function Loading() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="relative mx-auto h-14 w-14">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-[--color-border] border-t-[--color-accent]" />
      </div>
      <p className="font-pixel mt-5 text-sm text-[--color-accent-2] neon-cyan">
        CARGANDO...
      </p>
    </div>
  );
}
