export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <section className="page-content"><header className="page-heading"><span className="eyebrow">WebSphere</span><h1>{title}</h1><p>{description}</p></header><section className="panel empty-state"><h2>Your {title.toLowerCase()} starts here.</h2><p>This area will display your own workspace activity once you begin using it.</p></section></section>;
}
