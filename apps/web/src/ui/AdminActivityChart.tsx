import { useEffect, useState } from 'react';
import { request } from '../api';
import { ChartCanvas } from './ChartCanvas';
import { workspaceSubscription } from './workspaceSocket';

type Metric = 'users' | 'projects';
const periods = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'six-months', label: 'Last 6 Months' }] as const;
type Period = (typeof periods)[number]['value'];
type Activity = { current: number; points: Array<{ label: string; value: number | null }> };

export function AdminActivityChart({ metric, initialPeriod = 'weekly' }: { metric: Metric; initialPeriod?: Period }) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const projects = metric === 'projects';
  const title = projects ? 'Active Projects' : 'Active Users';
  useEffect(() => {
    const { on, dispose } = workspaceSubscription();
    const refresh = () => setRevision((value) => value + 1);
    let connected = false;
    on('connect', () => { if (connected) refresh(); connected = true; });
    on('admin:activity', (changed: Metric) => { if (metric === changed) refresh(); });
    return dispose;
  }, [metric]);
  useEffect(() => {
    const controller = new AbortController();
    void request<Activity>(`/admin/activity/${metric}?period=${period}`, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) { setActivity(value); setError(''); }
    }).catch((problem: Error) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [metric, period, revision]);
  const points = activity?.points.filter((point) => point.value !== null) ?? [];
  const values = points.map((point) => point.value!);
  const first = values[0];
  const change = values.length > 1 ? values.at(-1)! - first : null;
  const tint = projects ? '#1741ab' : '#19875b';
  return <section className="cc admin-activity-chart">
    <div className="cc-head"><h3>{title}</h3><div className="admin-periods" aria-label={`${title} reporting period`}>
      {periods.map((option) => <button key={option.value} type="button" aria-pressed={period === option.value} onClick={() => { if (period !== option.value) setActivity(null); setPeriod(option.value); }}>{option.label}</button>)}
    </div></div>
    {error ? <p role="alert">{error}</p> : null}
    {activity ? <>
      <p className="admin-active-now"><strong style={{ color: tint }}>{activity.current}</strong> active now</p>
      <dl className="admin-activity-stats">
        <div><dt>Average</dt><dd>{(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}</dd></div>
        <div><dt>Peak</dt><dd>{Math.max(...values)}</dd></div>
        <div><dt>Change</dt><dd>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}${first ? ` (${Math.round(change / first * 100)}%)` : ''}`}</dd></div>
      </dl>
      <ChartCanvas height={270} config={{ type: projects ? 'bar' : 'line', data: {
        labels: activity.points.map((point) => point.label),
        datasets: [{ label: title, data: activity.points.map((point) => point.value), borderColor: tint, backgroundColor: projects ? tint : '#19875b27', fill: !projects, tension: .25, borderRadius: 5 }],
      }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } }} />
      {points.length < activity.points.length ? <small>History begins with the first recorded count.</small> : null}
    </> : error ? <button type="button" className="btn-o" onClick={() => setRevision((value) => value + 1)}>Retry</button> : <p role="status">Loading activity…</p>}
  </section>;
}
