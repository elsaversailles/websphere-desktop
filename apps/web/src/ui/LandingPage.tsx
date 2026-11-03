type LandingPageProps = { onGetStarted: (mode: 'login' | 'register') => void };

export function LandingPage({ onGetStarted }: LandingPageProps) {
  return <main className="lp">
    <header className="lp-nav">
      <span className="lp-brand"><img src="/logo.png" alt="" />WebSphere</span>
      <nav className="lp-nav-actions" aria-label="Account">
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
    <section className="lp-app" aria-labelledby="mobile-title">
      <div className="lp-appbox">
        <div className="lp-apptxt">
          <span className="lp-ftag">New</span>
          <h2 id="mobile-title">WebSphere<br />Mobile App</h2>
          <p>Your group project, right in your pocket. Chat with your team, check tasks, and track deadlines wherever you are.<br />Free on Android and in your browser.</p>
          <div className="lp-appbtns">
            <a className="lp-store-btn" href="/downloads/websphere-mobile.apk"><span aria-hidden="true">▶</span><span><small>Download for</small><b>Android</b></span></a>
            <button type="button" className="lp-store-btn" onClick={() => onGetStarted('register')}><span aria-hidden="true">▣</span><span><small>Try now in</small><b>Browser</b></span></button>
          </div>
          <button type="button" className="lp-applink" onClick={() => onGetStarted('register')}>Create your free account ›</button>
        </div>
        <img className="lp-appimg" src="/landing/mobile.png" alt="WebSphere mobile app sign up screen" />
      </div>
    </section>
    <section className="lp-detail" aria-label="Explore WebSphere features">
      <FeatureBlock feature={dashboard} />
      <div className="lp-fgrid"><FeatureBlock feature={showcases[0]} /><FeatureBlock feature={showcases[1]} /></div>
      <FeatureBlock feature={showcases[2]} />
      <div className="lp-fgrid"><FeatureBlock feature={showcases[3]} /><FeatureBlock feature={showcases[4]} /></div>
      <FeatureBlock feature={showcases[5]} />
      <article className="lp-fblock">
        <span className="lp-ftag">Apps &amp; External Tools</span>
        <h2>Work in the tools your team already uses</h2>
        <p className="lp-fdesc">Open the apps your group relies on, from writing and spreadsheets to forms and task boards, all from one place in WebSphere.</p>
        <div className="lp-tools">{tools.map((tool) => <div className="lp-tool" key={tool.name}><span className="lp-tool-icon" aria-hidden="true">{tool.image ? <img src={tool.image} alt="" loading="lazy" /> : tool.icon}</span><b>{tool.name}</b><span>{tool.description}</span></div>)}</div>
      </article>
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
    <footer className="lp-footer"><span className="lp-brand"><img src="/logo.png" alt="" />WebSphere</span><small>Built for student project teams</small></footer>
  </main>;
}

type Feature = { tag: string; title: string; description: string; images: { src: string; alt: string }[]; points?: { title: string; description: string }[] };
function FeatureBlock({ feature }: { feature: Feature }) {
  return <article className="lp-fblock"><span className="lp-ftag">{feature.tag}</span><h2>{feature.title}</h2><p className="lp-fdesc">{feature.description}</p>
    {feature.points && <div className="lp-fpoints">{feature.points.map((point) => <div className="lp-fpoint" key={point.title}><b>{point.title}</b><span>{point.description}</span></div>)}</div>}
    <div className={`lp-shots${feature.images.length === 1 ? ' one' : ''}`}>{feature.images.map((image) => <figure className="lp-shot" key={image.src}><img src={image.src} alt={image.alt} loading="lazy" /></figure>)}</div>
  </article>;
}
const dashboard: Feature = { tag: 'Dashboard', title: 'Your whole project at a glance', description: 'The Dashboard is the first thing you see after signing in. It gives you an overview of your projects, tasks, and deadlines in one screen, so you always know what to work on next.', images: [{ src: '/landing/dashboard-summary.jpg', alt: 'Dashboard showing projects, tasks, and calendar' }, { src: '/landing/dashboard-progress.jpg', alt: 'Dashboard showing project progress, teammates, announcements, and milestones' }], points: [
  { title: 'Quick summary', description: 'See your active projects, pending tasks, and submitted ideas as soon as you log in.' }, { title: 'Recent projects', description: 'Track each project’s progress and status.' }, { title: 'My tasks', description: 'Check your assigned tasks with their deadline and priority level.' }, { title: 'Calendar', description: 'Deadlines are marked on the calendar so nothing sneaks up on you.' }, { title: 'Upcoming deadlines', description: 'See what is due in the next 14 days, flagged by urgency.' }, { title: 'Team activity', description: 'Follow what your teammates submitted and updated.' }, { title: 'Project progress overview', description: 'Compare active projects, members, and due dates.' }, { title: 'Online', description: 'See which teammates are online right now.' }, { title: 'Announcements', description: 'Read updates and reminders from your group leaders.' }, { title: 'Milestones & achievements', description: 'Celebrate progress and see the next milestone.' }
] };
const showcases: Feature[] = [
  { tag: 'AI Assistant', title: 'Plan your project with a built-in AI assistant', description: 'The WebSphere AI Assistant helps you and your group before the project even starts. Generate ideas, vote on them together, and get practical guidance for planning the whole project.', images: [{ src: '/landing/assistant.jpg', alt: 'AI Assistant chat with project planning actions' }] },
  { tag: 'Idea Management', title: 'Turn ideas into your next project', description: 'Everyone in the group can submit project ideas, review them together, and start a live vote to choose the idea your team will build.', images: [{ src: '/landing/ideas.jpg', alt: 'Idea Management page with submissions and voting' }] },
  { tag: 'Group Chat & Idea Voting', title: 'Talk it through and decide together', description: 'Each group has its own chat for communication and collaboration. Discuss your ideas with your teammates, then vote right beside the conversation to pick the project your team will work on.', images: [{ src: '/landing/chat.jpg', alt: 'Group chat with messages, members, and idea voting' }] },
  { tag: 'Workflow Analytics', title: 'See how your team is really doing', description: 'A visual summary of your project progress and team performance, with weekly task completion, member performance, bottleneck analysis, and tool usage in one place.', images: [{ src: '/landing/analytics.jpg', alt: 'Workflow Analytics dashboard showing team performance' }] },
  { tag: 'Predictive Monitoring', title: 'Catch delays before they happen', description: 'Get an early warning for tasks that might be delayed, with a risk level for each task, AI predictions and alerts, and a predicted timeline with recommendations.', images: [{ src: '/landing/monitoring.jpg', alt: 'Predictive Monitoring showing task risks and predictions' }] },
  { tag: 'Calendar', title: 'Every event and deadline in one calendar', description: 'See your team’s events and chapter deadlines laid out by month, so you always know what is coming up. Add new events right from the calendar and jump back to today with one click.', images: [{ src: '/landing/calendar.jpg', alt: 'Calendar showing events and deadlines for the month' }] },
];
const tools = [
  { name: 'Google Drive & Docs', description: 'Store files and write documents together', icon: '▲' },
  { name: 'Google Forms', description: 'Create surveys and collect responses', icon: '▤' },
  { name: 'Microsoft Word', description: 'Write and format your thesis chapters', image: '/landing/word.png' },
  { name: 'Microsoft Excel', description: 'Organize and analyze data in spreadsheets', image: '/landing/excel.png' },
  { name: 'Trello', description: 'Track tasks and milestones with boards', icon: '▥' },
  { name: 'Asana', description: 'Manage team work and deadlines', icon: '●●●' },
];
