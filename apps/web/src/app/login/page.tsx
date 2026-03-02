import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6">
      <section className="panel grid w-full max-w-3xl grid-cols-1 overflow-hidden lg:grid-cols-2">
        <div className="bg-ink p-8 text-sand">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Coastal Eats</p>
          <h1 className="mt-3 font-[var(--font-heading)] text-3xl font-semibold">ShiftSync MVP</h1>
          <p className="mt-3 text-sm text-slate-100/85">
            Multi-location scheduling across LA and New York. Log in as Admin, Manager, or Staff.
          </p>
        </div>
        <div className="p-8">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}