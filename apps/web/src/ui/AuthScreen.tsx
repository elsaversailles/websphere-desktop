import { ChangeEvent, FormEvent, useState } from 'react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordRequirements } from '@websphere/shared';
import { authenticate, request, saveSession, type Session } from '../api';

type AuthScreenProps = { onAuthenticated: (session: Session) => void; notify: (message: string) => void; initialMode?: 'login' | 'register'; onBack?: () => void };
type AuthMode = 'login' | 'register' | 'verify' | 'admin' | 'forgot' | 'reset' | 'deactivate';
type RegistrationData = { fullName: string; email: string; password: string; institution: string; course: string };

/** Sentinel option value for "Others" on the course/institution selects — never submitted as-is, see SelectWithOther. */
const OTHER_OPTION = '__other__';

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
  const [registerPassword, setRegisterPassword] = useState('');
  const [resetPassword, setResetPasswordValue] = useState('');
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

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
    // The checklist already gives live feedback as they type; this is the submit-time guard so a
    // password that never satisfied every rule can't reach the server at all.
    if (!passwordRequirements(String(data.get('password') ?? '')).every((requirement) => requirement.met)) return setErrorMessage('Your password does not meet all of the requirements below.');
    if (data.get('password') !== data.get('confirm')) return setErrorMessage('Your passwords do not match.');
    if (!agreedToPrivacy) return setErrorMessage('Please agree to the Privacy Policy to continue.');
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

  async function submitDeactivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const reason = String(data.get('reason') ?? '').trim();
    setErrorMessage('');
    setBusy(true);
    try {
      await request('/auth/deactivation-request', { method: 'POST', body: JSON.stringify({ email, reason }) });
      setMessage('Your deactivation request has been sent to our support team. They will reach out to the email you provided.');
      setMode('login');
    } catch (error: unknown) { showError(error); } finally { setBusy(false); }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrorMessage('');
    if (!passwordRequirements(String(data.get('password') ?? '')).every((requirement) => requirement.met)) return setErrorMessage('Your password does not meet all of the requirements below.');
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
      <p className="alink admin-link"><button type="button" onClick={() => changeMode('admin')}>Admin login</button> · <button type="button" onClick={() => changeMode('deactivate')}>Deactivate account</button></p>
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
      <SelectWithOther label="Course" name="course" options={courses} placeholder="Select your course" />
      <SelectWithOther label="School / Institution" name="institution" options={schools} placeholder="Select your school" />
      <AuthField label="Password" name="password" type="password" placeholder="Enter your password" onChange={(event) => setRegisterPassword(event.target.value)} />
      <PasswordChecklist password={registerPassword} />
      <AuthField label="Confirm Password" name="confirm" type="password" placeholder="Confirm your password" />
      <label className="auth-consent"><input type="checkbox" required checked={agreedToPrivacy} onChange={(event) => setAgreedToPrivacy(event.target.checked)} /><span>I agree to the <button type="button" className="auth-inline-link" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button><span className="required-mark" aria-hidden="true"> *</span></span></label>
      <button className="abtn register-submit" disabled={busy}>{busy ? 'Sending code…' : 'Continue'}</button>
      <p className="alink">Already have an account? <button type="button" onClick={() => changeMode('login')}>Sign in here</button></p>
    </form> : null}
    {privacyOpen ? <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} onAccept={() => { setAgreedToPrivacy(true); setPrivacyOpen(false); }} /> : null}
    {mode === 'verify' ? <form className="abox" onSubmit={(event) => void submitVerification(event)}>
      <h1 className="atitle">Verify Your Email</h1><p className="asub">Enter the six-digit code sent to {registration?.email ?? 'your email address'}.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <label className="auth-field"><span className="lbl">Verification Code<span className="required-mark" aria-hidden="true"> *</span></span><input className="afield otp-field" required name="verificationCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456" /></label>
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
    {mode === 'deactivate' ? <form className="abox" onSubmit={(event) => void submitDeactivation(event)}>
      <h1 className="atitle">Deactivate Account</h1><p className="asub">Send a request to our support team to deactivate your account. We&apos;ll follow up at the email you provide.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="Email Address" name="email" type="email" placeholder="your@email.com" />
      <label className="auth-field"><span className="lbl">Reason (optional)</span><textarea className="afield" name="reason" rows={3} maxLength={1000} placeholder="Let us know why you'd like to deactivate your account" /></label>
      <button className="abtn" disabled={busy}>{busy ? 'Sending…' : 'Send Deactivation Request'}</button>
      <p className="alink"><button type="button" onClick={() => changeMode('login')}>Back to sign in</button></p>
    </form> : null}
    {mode === 'reset' ? <form className="abox" onSubmit={(event) => void submitReset(event)}>
      <h1 className="atitle">Choose a New Password</h1><p className="asub">Your reset link can only be used once.</p>
      <AuthFeedback error={errorMessage} message={message} />
      <AuthField label="New Password" name="password" type="password" placeholder="Enter a new password" onChange={(event) => setResetPasswordValue(event.target.value)} />
      <PasswordChecklist password={resetPassword} />
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

function AuthField({ label, name, type = 'text', placeholder, onChange }: { label: string; name: string; type?: string; placeholder: string; onChange?: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field"><span className="lbl">{label}<span className="required-mark" aria-hidden="true"> *</span></span><span className="auth-input-wrap"><input className={`afield${type === 'password' ? ' afield-pw' : ''}`} required minLength={type === 'password' ? PASSWORD_MIN_LENGTH : undefined} maxLength={type === 'password' ? PASSWORD_MAX_LENGTH : undefined} name={name} type={type === 'password' && visible ? 'text' : type} placeholder={placeholder} onChange={onChange} />{type === 'password' ? <button className="auth-eye" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}><EyeIcon open={visible} /></button> : null}</span></label>;
}

/** Guided choice with a required-field asterisk and a free-text fallback when the user picks "Others" —
 * when Others is selected the <select> itself carries no `name`, so only the typed value is submitted. */
function SelectWithOther({ label, name, options, placeholder }: { label: string; name: string; options: string[]; placeholder: string }) {
  const id = `field-${name}`;
  const [choice, setChoice] = useState('');
  const isOther = choice === OTHER_OPTION;
  return <div className="auth-field">
    <label className="lbl" htmlFor={id}>{label}<span className="required-mark" aria-hidden="true"> *</span></label>
    <select id={id} className="afield" required={!isOther} name={isOther ? undefined : name} value={choice} onChange={(event) => setChoice(event.target.value)}>
      <option value="" disabled>{placeholder}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
      <option value={OTHER_OPTION}>Others</option>
    </select>
    {isOther ? <input className="afield" style={{ marginTop: 8 }} required name={name} maxLength={160} placeholder={`Please specify your ${label.toLowerCase()}`} /> : null}
  </div>;
}

function PasswordChecklist({ password }: { password: string }) {
  if (!password) return null;
  return <ul className="password-checklist">{passwordRequirements(password).map((requirement) => <li key={requirement.id} className={requirement.met ? 'met' : 'unmet'}><span aria-hidden="true">{requirement.met ? '✓' : '✕'}</span> {requirement.label}</li>)}</ul>;
}

function PrivacyPolicyModal({ onClose, onAccept }: { onClose: () => void; onAccept: () => void }) {
  return <div className="modal-ov open" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-box privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-policy-title">
      <div className="modal-ttl"><span id="privacy-policy-title">Privacy Policy</span><button className="modal-close" type="button" onClick={onClose} aria-label="Close">&times;</button></div>
      <div className="privacy-body">
        <h3>Information we collect</h3>
        <p>Your name, email address, school/institution, course, and password (stored only as a one-way hash, never in plain text). A profile photo, if you choose to upload one. Content you create in WebSphere &mdash; group messages, submitted ideas and votes, projects, tasks, and calendar events. If you connect an external tool (Google Drive, Microsoft 365, Trello, Asana, Canva, or Figma), the access token for that connection, stored encrypted, and the files or designs you choose to link. Your conversations with the WebSphere AI assistant. The push-notification endpoint for your device, if you enable push notifications.</p>
        <h3>How we use it</h3>
        <p>To operate your account, groups, projects, tasks, and dashboard. To notify you about deadlines, assignments, group activity, and support responses. To power the AI assistant&rsquo;s academic help, grounded only in project data you and your group members already have access to. To detect and prevent abuse, such as accounts created with disposable email addresses.</p>
        <h3>Who can see it</h3>
        <p>Members of a group or project you belong to can see the content you post there. WebSphere administrators can see account status, support tickets, and system audit logs, for moderation and support. Nobody outside WebSphere sees your data &mdash; we do not sell or share it with advertisers.</p>
        <h3>Third-party services</h3>
        <p>Connected tools are only accessed once you explicitly connect them, and only for the files or designs you link. Prompts you send the AI assistant are processed by OpenAI to generate a response. Email delivery is used for verification codes and password resets.</p>
        <h3>Data security</h3>
        <p>Passwords are hashed with argon2 and never stored or logged in plain text. External-tool access tokens are encrypted at rest. Sessions use short-lived access tokens with rotating refresh tokens; logging out invalidates them immediately.</p>
        <h3>Your rights</h3>
        <p>You can edit your profile at any time from Settings, disconnect any external tool at any time (which removes its stored access token), and request account deactivation or deletion through a support ticket.</p>
        <h3>Changes to this policy</h3>
        <p>We may update this policy as WebSphere adds features. Material changes will be announced in-app.</p>
      </div>
      <div className="modal-acts"><button type="button" className="btn-o" onClick={onClose}>Close</button><button type="button" className="btn" onClick={onAccept}>I Agree</button></div>
    </div>
  </div>;
}
