import { FormEvent, useState } from 'react';
import { authenticate, request, saveSession, type Session } from '../api';

type AuthScreenProps = { onAuthenticated: (session: Session) => void; notify: (message: string) => void; initialMode?: 'login' | 'register'; onBack?: () => void };
type AuthMode = 'login' | 'register' | 'verify' | 'admin' | 'forgot' | 'reset';
type RegistrationData = { fullName: string; email: string; password: string; institution: string; course: string };

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

export function AuthScreen({ onAuthenticated, notify, initialMode = 'register', onBack }: AuthScreenProps) {
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') ?? '');
  const [mode, setMode] = useState<AuthMode>(() => resetToken ? 'reset' : initialMode);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [message, setMessage] = useState('');
  const [registration, setRegistration] = useState<RegistrationData | null>(null);
  const [verificationId, setVerificationId] = useState('');

  function changeMode(next: AuthMode) { setErrorMessage(''); setMessage(''); setMode(next); }
  function showError(error: unknown) { setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.'); }

  async function submitLogin(event: FormEvent<HTMLFormElement>, admin: boolean) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrorMessage('');
    setBusy(true);
    try {
      const session = await authenticate(String(data.get('email') ?? ''), String(data.get('password') ?? ''), admin);
      saveSession(session);
      onAuthenticated(session);
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrorMessage('');
    if (data.get('password') !== data.get('confirm')) return setErrorMessage('Your passwords do not match.');
    const pending: RegistrationData = {
      fullName: `${data.get('firstName')} ${data.get('lastName')}`.trim(),
      email: String(data.get('email') ?? '').trim(), password: String(data.get('password') ?? ''),
      institution: String(data.get('institution') ?? ''), course: String(data.get('course') ?? ''),
    };
    setBusy(true);
    try {
      const result = await request<{ ok: true; verificationId: string }>('/auth/registration/otp', { method: 'POST', body: JSON.stringify({ email: pending.email }) });
      setRegistration(pending);
      setVerificationId(result.verificationId);
      setMessage(`We sent a six-digit code to ${pending.email}.`);
      setMode('verify');
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function resendVerification() {
    if (!registration) return;
    setErrorMessage('');
    setBusy(true);
    try {
      const result = await request<{ ok: true; verificationId: string }>('/auth/registration/otp', { method: 'POST', body: JSON.stringify({ email: registration.email }) });
      setVerificationId(result.verificationId);
      setMessage(`A new code was sent to ${registration.email}.`);
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registration || !verificationId) return setErrorMessage('Your registration details are unavailable. Please start again.');
    const verificationCode = String(new FormData(event.currentTarget).get('verificationCode') ?? '').trim();
    setErrorMessage('');
    setBusy(true);
    try {
      await request('/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, verificationId, verificationCode }) });
      setRegistration(null);
      setVerificationId('');
      setMessage('Email verified. Your account is ready—please sign in.');
      setMode('login');
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function submitForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setErrorMessage('');
    setBusy(true);
    try {
      const result = await request<{ ok: true; resetToken?: string }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      setMessage('If that locked account exists, a reset link has been sent.');
      if (result.resetToken) { setResetToken(result.resetToken); setMode('reset'); }
      else setMode('login');
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrorMessage('');
    if (data.get('password') !== data.get('confirm')) return setErrorMessage('Your passwords do not match.');
    setBusy(true);
    try {
      await request('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token: resetToken, password: data.get('password'), confirm: data.get('confirm') }) });
      window.history.replaceState({}, '', window.location.pathname);
      setResetToken('');
      setMessage('Password reset complete. You can sign in now.');
      setMode('login');
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  return <main className="auth-wrap">
    <div className="swirl s1" /><div className="swirl s2" />
    {onBack ? <button type="button" className="auth-back" onClick={onBack}>&larr; Back to home</button> : null}
    {mode === 'login' ? <form className="abox" onSubmit={(event) => void submitLogin(event, false)}>
      <h1 className="atitle">Welcome Back</h1><p className="asub">Sign in to your account to continue</p>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="Email Address" name="email" type="email" placeholder="your@gmail.com" />
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <button className="aforgot" type="button" onClick={() => changeMode('forgot')}>Forgot password?</button>
      <button className="abtn" disabled={busy}>{busy ? 'Signing In…' : 'Sign In'}</button>
      <p className="alink">Don&apos;t have an account? <button type="button" onClick={() => changeMode('register')}>Register here</button></p>
      <p className="alink admin-link"><button type="button" onClick={() => changeMode('admin')}>Admin login</button></p>
    </form> : null}
    {mode === 'admin' ? <form className="abox" onSubmit={(event) => void submitLogin(event, true)}>
      <h1 className="atitle admin-title">Administrator Login</h1>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="Admin Email" name="email" type="email" placeholder="admin@gmail.com" />
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <button className="aforgot" type="button" onClick={() => changeMode('forgot')}>Forgot admin password?</button>
      <button className="abtn" disabled={busy}>{busy ? 'Signing In…' : 'Sign In as Admin'}</button>
      <p className="alink admin-link"><button type="button" onClick={() => changeMode('login')}>User login</button></p>
    </form> : null}
    {mode === 'register' ? <form className="abox register-box" onSubmit={(event) => void submitRegister(event)}>
      <h1 className="atitle register-title">Create an Account</h1>
      <AuthFeedback error={errorMessage} message={message} />
      <div className="auth-two"><AuthField label="First Name" name="firstName" placeholder="First Name" /><AuthField label="Last Name" name="lastName" placeholder="Last Name" /></div>
      <AuthField label="Email Address" name="email" type="email" placeholder="your@email.com" />
      <AuthField label="Course" name="course" list="course-options" placeholder="Select or type your course" />
      <datalist id="course-options">{courses.map((course) => <option key={course}>{course}</option>)}</datalist>
      <AuthField label="School / Institution" name="institution" list="school-options" placeholder="Select or type your school" />
      <datalist id="school-options">{schools.map((school) => <option key={school}>{school}</option>)}</datalist>
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" />
      <AuthField label="Confirm Password" name="confirm" type="password" placeholder="Confirm your password" />
      <button className="abtn register-submit" disabled={busy}>{busy ? 'Sending code…' : 'Continue'}</button>
      <p className="alink">Already have an account? <button type="button" onClick={() => changeMode('login')}>Sign in here</button></p>
    </form> : null}
    {mode === 'verify' ? <form className="abox" onSubmit={(event) => void submitVerification(event)}>
      <h1 className="atitle">Verify Your Email</h1><p className="asub">Enter the six-digit code sent to {registration?.email ?? 'your email address'}.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <label className="auth-field"><span className="lbl">Verification Code</span><input className="afield otp-field" required name="verificationCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456" /></label>
      <button className="abtn" disabled={busy}>{busy ? 'Verifying…' : 'Verify & Create Account'}</button>
      <p className="alink"><button type="button" disabled={busy} onClick={() => void resendVerification()}>Resend code</button> · <button type="button" disabled={busy} onClick={() => changeMode('register')}>Edit details</button></p>
    </form> : null}
    {mode === 'forgot' ? <form className="abox" onSubmit={(event) => void submitForgot(event)}>
      <h1 className="atitle">Reset Password</h1><p className="asub">Locked accounts receive a one-time reset link by email.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="Email Address" name="email" type="email" placeholder="your@email.com" />
      <button className="abtn" disabled={busy}>{busy ? 'Sending…' : 'Send Reset Link'}</button>
      <p className="alink"><button type="button" onClick={() => changeMode('login')}>Back to sign in</button></p>
    </form> : null}
    {mode === 'reset' ? <form className="abox" onSubmit={(event) => void submitReset(event)}>
      <h1 className="atitle">Choose a New Password</h1><p className="asub">Your reset link can only be used once.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="New Password" name="password" type="password" placeholder="Enter a new password" />
      <AuthField label="Confirm Password" name="confirm" type="password" placeholder="Confirm your new password" />
      <button className="abtn" disabled={busy || !resetToken}>{busy ? 'Resetting…' : 'Reset Password'}</button>
      <p className="alink"><button type="button" onClick={() => changeMode('login')}>Back to sign in</button></p>
    </form> : null}
  </main>;
}

function AuthFeedback({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return <p className={`auth-feedback ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || message}</p>;
}

function EyeIcon({ open }: { open: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {open ? <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </> : <>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61C3.06 8.93 1 12 1 12s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </>}
  </svg>;
}

function AuthField({ label, name, type = 'text', placeholder, list }: { label: string; name: string; type?: string; placeholder: string; list?: string }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field"><span className="lbl">{label}</span><span className="auth-input-wrap"><input className={`afield${type === 'password' ? ' afield-pw' : ''}`} required minLength={type === 'password' ? 8 : undefined} name={name} type={type === 'password' && visible ? 'text' : type} placeholder={placeholder} list={list} />{type === 'password' ? <button className="auth-eye" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}><EyeIcon open={visible} /></button> : null}</span></label>;
}
