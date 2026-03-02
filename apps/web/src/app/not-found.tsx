export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <section className="panel w-full p-8 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">404</p>
        <h1 className="mt-2 font-[var(--font-heading)] text-3xl font-semibold text-ink">Page Not Found</h1>
        <p className="mt-3 text-sm text-slate-600">The page you requested does not exist.</p>
      </section>
    </main>
  );
}