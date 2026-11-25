import { useEffect, useState } from 'react';
import type { Plugin, ScriptableContext } from 'chart.js';
import { request } from '../api';
import { ChartCanvas } from './ChartCanvas';
import { workspaceSubscription } from './workspaceSocket';

type Metric = 'users' | 'projects';
const periods = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'six-months', label: '6 Months' }] as const;
type Period = (typeof periods)[number]['value'];
type Activity = { current: number; points: Array<{ label: string; value: number | null }> };

const chartValues: Plugin = {
  id: 'adminActivityValues',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const dataset = chart.data.datasets[0];
    const elements = chart.getDatasetMeta(0).data;
    const isBar = chart.getDatasetMeta(0).type === 'bar';
    const stride = Math.max(1, Math.ceil(elements.length / (chart.width / 46)));
    ctx.save();
    ctx.font = '700 12px Outfit, sans-serif';
    ctx.fillStyle = typeof dataset.borderColor === 'string' ? dataset.borderColor : '#0038a8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    elements.forEach((element, index) => {
      const value = dataset.data[index];
      if (typeof value !== 'number' || (index % stride && index !== elements.length - 1)) return;
      if (isBar && value === 0) return;
      ctx.fillText(String(value), element.x, element.y - 8);
    });
    ctx.restore();
  },
};

function chartFill({ chart }: ScriptableContext<'bar' | 'line'>, projects: boolean) {
  const area = chart.chartArea;
  const start = projects ? '#6389c6' : '#1c99616b';
  const end = projects ? '#a8c1e0' : '#1c996100';
  if (!area) return start;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  return gradient;
}

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
  const tint = projects ? '#0038a8' : '#19965e';
  const hasGaps = activity?.points.some((point) => point.value === null);
  return <section className="cc admin-activity-chart">
    <div className="cc-head"><h3 className="admin-chart-title"><strong style={{ color: tint }} title={projects ? 'Total currently active projects' : undefined}>{activity?.current ?? '—'}</strong>{title}</h3>
      <div className="admin-periods" role="group" aria-label={`${title} reporting period`}>
        {periods.map((option) => <button key={option.value} type="button" aria-pressed={period === option.value} onClick={() => {
          if (period !== option.value) { setActivity(null); setError(''); setPeriod(option.value); }
        }}>{option.label}</button>)}
      </div>
    </div>
    <div className="admin-chart-plot">
      {activity ? <ChartCanvas height={260} label={`${title}. ${activity.points.map(({ label, value }) => `${label}: ${value ?? 'no data'}`).join(', ')}`} config={{
        type: projects ? 'bar' : 'line',
        data: {
          labels: activity.points.map((point) => point.label),
          datasets: [{
            label: title,
            data: activity.points.map((point) => point.value),
            borderColor: tint,
            backgroundColor: (context: ScriptableContext<'bar' | 'line'>) => chartFill(context, projects),
            hoverBackgroundColor: tint,
            fill: !projects,
            cubicInterpolationMode: 'monotone',
            borderWidth: projects ? 0 : 4,
            borderRadius: 6,
            borderSkipped: false,
            pointRadius: activity.points.length > 12 ? 2 : 3.5,
            pointBorderWidth: 2,
            pointBackgroundColor: '#fff',
          }],
        },
        plugins: [chartValues],
        options: {
          maintainAspectRatio: false,
          layout: { padding: { top: 17, right: 5 } },
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: '#0b3a52', padding: 10, displayColors: false },
          },
          scales: {
            x: {
              offset: true, grid: { display: false }, border: { color: '#9bb7da' },
              ticks: { color: '#397a96', font: { family: 'Outfit, Arial, sans-serif', weight: 600 }, maxRotation: 0, maxTicksLimit: 8 },
            },
            y: {
              beginAtZero: true, grace: 1, grid: { color: '#c9def2', drawTicks: false },
              border: { display: false, dash: [3, 4] },
              ticks: { color: '#397a96', font: { family: 'Outfit, Arial, sans-serif', weight: 600 }, precision: 0, maxTicksLimit: 5, padding: 7 },
            },
          },
        },
      }} /> : error ? <div className="admin-chart-message"><p role="alert">{error}</p><button type="button" className="btn-o" onClick={() => { setError(''); setRevision((value) => value + 1); }}>Retry</button></div> : <p className="admin-chart-message" role="status">Loading activity…</p>}
    </div>
    {hasGaps ? <small className="admin-chart-history">History begins with the first recorded count.</small> : null}
  </section>;
}
