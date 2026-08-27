import { FormEvent, useState } from 'react';
import { authenticate, request, saveSession, type Session } from '../api';

type AuthScreenProps = { onAuthenticated: (session: Session) => void; notify: (message: string) => void };
type AuthMode = 'login' | 'register' | 'admin';

const courses = [
  'Bachelor of Science in Information Technology', 'Bachelor of Science in Computer Science',
  'Bachelor of Science in Computer Engineering', 'Bachelor of Science in Information Systems',
  'Bachelor of Science in Accountancy', 'Bachelor of Science in Business Administration',
  'Bachelor of Science in Nursing', 'Bachelor of Science in Psychology',
];
const schools = [
  'STI College San Jose Del Monte', 'Colegio De San Gabriel Arcangel - Poblacion Campus',
  'City College of San Jose Del Monte', 'Bulacan State University - Sarmiento Campus',
  'La Concepcion College', 'Siena College of San Jose',
];

export function AuthScreen({ onAuthenticated, notify }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('register');
  const [busy, setBusy] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>, admin: boolean) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const session = await authenticate(String(data.get('email') ?? ''), String(data.get('password') ?? ''), admin);
      saveSession(session);
      onAuthenticated(session);
    } catch (error: any) { notify(error.message); } finally { setBusy(false); }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) return notify('Your password does not match.');
    setBusy(true);
    try {
      await request('/auth/register', { method: 'POST', body: JSON.stringify({
        fullName: `${data.get('firstName')} ${data.get('lastName')}`.trim(), email: data.get('email'),
        password: data.get('password'), institution: data.get('institution'), course: data.get('course'),
      }) });
      notify('Account created. You can sign in now.');
      setMode('login');
    } catch (error: any) { notify(error.message); } finally { setBusy(false); }
  }

  return <main className="auth-wrap">
    <div className="swirl s1" /><div className="swirl s2" />
    {mode === 'login' ? <form className="abox" onSubmit={(event) => void submitLogin(event, false)}>
      <h1 className="atitle">Welcome Back</h1><p className="asub">Sign in to your account to continue</p>
      <AuthField label="Email Address" name="email" type="email" placeholder="your@gmail.com" />
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <button className="aforgot" type="button" onClick={() => notify('Password reset will be sent to your registered email.')}>Forgot password?</button>
      <button className="abtn" disabled={busy}>{busy ? 'Signing In…' : 'Sign In'}</button>
      <p className="alink">Don&apos;t have an account? <button type="button" onClick={() => setMode('register')}>Register here</button></p>
      <p className="alink admin-link"><button type="button" onClick={() => setMode('admin')}>Admin login</button></p>
    </form> : null}
    {mode === 'admin' ? <form className="abox" onSubmit={(event) => void submitLogin(event, true)}>
      <h1 className="atitle admin-title">Administrator Login</h1>
      <AuthField label="Admin Email" name="email" type="email" placeholder="admin@gmail.com" />
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <button className="aforgot" type="button" onClick={() => notify('Admin password reset will be sent to the registered email.')}>Forgot admin password?</button>
      <button className="abtn" disabled={busy}>{busy ? 'Signing In…' : 'Sign In as Admin'}</button>
      <p className="alink admin-link"><button type="button" onClick={() => setMode('login')}>User login</button></p>
    </form> : null}
    {mode === 'register' ? <form className="abox register-box" onSubmit={(event) => void submitRegister(event)}>
      <h1 className="atitle register-title">Create an Account</h1>
      <div className="auth-two"><AuthField label="First Name" name="firstName" placeholder="First Name" /><AuthField label="Last Name" name="lastName" placeholder="Last Name" /></div>
      <AuthField label="Email Address" name="email" type="email" placeholder="your@email.com" />
      <AuthField label="Course" name="course" list="course-options" placeholder="Select or type your course" />
      <datalist id="course-options">{courses.map((course) => <option key={course}>{course}</option>)}</datalist>
      <AuthField label="School / Institution" name="institution" list="school-options" placeholder="Select or type your school" />
      <datalist id="school-options">{schools.map((school) => <option key={school}>{school}</option>)}</datalist>
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <AuthField label="Confirm Password" name="confirm" type="password" placeholder="Confirm your password" />
      <button className="abtn register-submit" disabled={busy}>{busy ? 'Creating Account…' : 'Create Account'}</button>
      <p className="alink">Already have an account? <button type="button" onClick={() => setMode('login')}>Sign in here</button></p>
    </form> : null}
  </main>;
}

function AuthField({ label, name, type = 'text', placeholder, list }: { label: string; name: string; type?: string; placeholder: string; list?: string }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field"><span className="lbl">{label}</span><span className={`auth-input-wrap ${list ? 'auth-combo' : ''}`}><input className="afield" required minLength={type === 'password' ? 8 : undefined} name={name} type={type === 'password' && visible ? 'text' : type} placeholder={placeholder} list={list} />{type === 'password' ? <button className="auth-eye" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}>{visible ? '◉' : '⊘'}</button> : list ? <span className="auth-arrow">⌄</span> : null}</span></label>;
}
