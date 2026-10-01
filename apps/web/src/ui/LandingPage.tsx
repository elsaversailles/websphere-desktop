type LandingPageProps = { onGetStarted: (mode: 'login' | 'register') => void };

/** The first screen a signed-out visitor sees; every action hands off to AuthScreen. */
export function LandingPage({ onGetStarted }: LandingPageProps) {
  return <main className="lp">
    <header className="lp-nav">
      <span className="lp-brand"><img src="/logo.png" alt="" />WebSphere</span>
      <nav className="lp-nav-actions">
        <button type="button" className="lp-ghost" onClick={() => onGetStarted('login')}>Sign in</button>
        <button type="button" className="lp-btn" onClick={() => onGetStarted('register')}>Get started</button>
      </nav>
    </header>

    <section className="lp-hero">
      <span className="swirl s1" aria-hidden="true" /><span className="swirl s2" aria-hidden="true" />
      <div className="lp-hero-copy">
        <span className="lp-eyebrow">For student project teams</span>
        <h1>One workspace for the whole <em>academic project</em></h1>
        <p>Group chat, idea voting, tasks, deadlines, and progress that tracks itself, so your team stops losing the project across five different apps</p>
        <div className="lp-hero-actions">
          <button type="button" className="lp-btn lp-btn-lg" onClick={() => onGetStarted('register')}>Get started free</button>
          <button type="button" className="lp-ghost lp-btn-lg" onClick={() => onGetStarted('login')}>I already have an account</button>
        </div>
      </div>
    </section>

    <section className="lp-features">
      {features.map((feature) => <article className="lp-card" key={feature.title}>
        <span className="lp-card-icon" aria-hidden="true">{feature.icon}</span>
        <h2>{feature.title}</h2>
        <p>{feature.body}</p>
      </article>)}
    </section>

    <section className="lp-steps">
      <h2>From idea to finished project</h2>
      <ol>
        <li><strong>Form your group</strong><span>Create one or join with a code</span></li>
        <li><strong>Pitch and vote</strong><span>Decide together, inside a time limit</span></li>
        <li><strong>Build it</strong><span>Tasks, owners, real deadlines</span></li>
        <li><strong>Stay ahead</strong><span>Know a deadline is slipping before it does</span></li>
      </ol>
    </section>

    <section className="lp-cta">
      <h2>Your next group project deserves better than five group chats</h2>
      <button type="button" className="lp-btn lp-btn-lg" onClick={() => onGetStarted('register')}>Get started free</button>
    </section>

    <footer className="lp-footer">
      <span className="lp-brand"><img src="/logo.png" alt="" />WebSphere</span>
      <small>Built for student project teams</small>
    </footer>
  </main>;
}

const features = [
  { title: 'Groups and chat', body: 'Talk it through live and keep the decisions in the same place as the work', icon: <ChatIcon /> },
  { title: 'Idea voting', body: 'Everyone submits, everyone votes, the leader sets how long voting stays open', icon: <IdeaIcon /> },
  { title: 'Tasks that track themselves', body: 'Progress comes from the work your team actually completes, never a typed-in percentage', icon: <CheckIcon /> },
  { title: 'Early warning on deadlines', body: 'See which project is drifting, and the numbers behind why it is drifting', icon: <RiskIcon /> },
];

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function ChatIcon() { return <svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>; }
function IdeaIcon() { return <svg {...iconProps}><path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5z" /></svg>; }
function CheckIcon() { return <svg {...iconProps}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>; }
function RiskIcon() { return <svg {...iconProps}><path d="M18 20V10M12 20V4M6 20v-6" /></svg>; }
