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
      <span className="lp-hero-glow lp-hero-glow-left" aria-hidden="true" />
      <span className="lp-hero-glow lp-hero-glow-right" aria-hidden="true" />
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

    <section className="lp-features" aria-label="WebSphere features">
      {features.map((feature) => <article className="lp-card" key={feature.title}>
        <span className="lp-card-icon" aria-hidden="true">{feature.icon}</span>
        <h2>{feature.title}</h2>
        <p>{feature.body}</p>
      </article>)}
    </section>

    <section className="lp-steps">
      <div className="lp-steps-inner">
      <h2>Make group projects easier, from day one</h2>
      <ol>
        <li><strong>Bring your team together</strong><span>Create a group or join with one code.</span></li>
        <li><strong>Choose your best idea</strong><span>Pitch, vote, and move forward together.</span></li>
        <li><strong>Know what comes next</strong><span>Assign tasks and see every step of progress.</span></li>
        <li><strong>Finish with confidence</strong><span>Spot delays early and stay on schedule.</span></li>
      </ol>
      </div>
    </section>

    <section className="lp-cta">
      <div className="lp-cta-glow" aria-hidden="true" />
      <div className="lp-cta-content">
        <h2>Less chasing. More creating.<br />Your best group project starts here.</h2>
        <button type="button" className="lp-btn lp-btn-lg" onClick={() => onGetStarted('register')}>Start your project free</button>
      </div>
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
