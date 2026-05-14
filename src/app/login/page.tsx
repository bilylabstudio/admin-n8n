export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="shell">
      <form className="panel form" action="/api/login" method="post">
        <h1>Review Admin</h1>
        <p>Acceso interno para revisar respuestas antes de enviarlas.</p>
        {searchParams.error ? <p style={{ color: 'var(--danger)' }}>Credenciales incorrectas.</p> : null}
        <label>
          Email
          <input className="input" name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Contraseña
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="button" type="submit">Entrar</button>
      </form>
    </main>
  );
}
