type Activity = { kind: 'workflow' | 'integration'; type?: string; fromValue?: string | null; toValue?: string | null; action?: string };
type ActivityKind = 'completed' | 'assigned' | 'unassigned' | 'pending' | 'ongoing' | 'review' | 'linked' | 'edited' | 'opened' | 'synced' | 'updated';

function activityKind(activity: Activity): ActivityKind {
  if (activity.kind === 'integration') {
    const action = activity.action?.trim().toLowerCase() ?? '';
    if (action.startsWith('linked')) return 'linked';
    if (action.startsWith('opened') || action.startsWith('launched')) return 'opened';
    if (action.startsWith('updated')) return 'edited';
    if (action.startsWith('synced')) return 'synced';
    return 'updated';
  }
  if (activity.type === 'task_completed' || (activity.type === 'status_change' && activity.toValue === 'completed')) return 'completed';
  if (activity.type === 'assignment_change') return activity.toValue ? 'assigned' : 'unassigned';
  if (activity.type === 'progress_activity') return activity.fromValue === 'resource_linked' ? 'linked' : 'updated';
  if (activity.type === 'status_change') {
    if (activity.toValue === 'pending') return 'pending';
    if (activity.toValue === 'ongoing') return 'ongoing';
    if (activity.toValue === 'for_review') return 'review';
  }
  return 'updated';
}

const labels: Record<ActivityKind, string> = {
  completed: 'Task completed', assigned: 'Task assigned', unassigned: 'Task unassigned',
  pending: 'Task not started', ongoing: 'Task in progress', review: 'Task submitted for review',
  linked: 'File linked', edited: 'File edited', opened: 'File opened', synced: 'Files synced', updated: 'Activity updated',
};

export function TrackerActivityIcon({ activity }: { activity: Activity }) {
  const kind = activityKind(activity);
  const mark = {
    completed: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    assigned: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 8v6M16 11h6" /></>,
    unassigned: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 11h6" /></>,
    pending: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    ongoing: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    review: <><rect x="5" y="4" width="14" height="17" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="m8 13 3 3 5-6" /></>,
    linked: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.75 5.2M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
    edited: <><path d="m15 4 5 5M4 16l-1 5 5-1L21 7a2 2 0 0 0-5-5z" /></>,
    opened: <><path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    synced: <><path d="M20 7a9 9 0 0 0-15-2L2 8M2 3v5h5M4 17a9 9 0 0 0 15 2l3-3M22 21v-5h-5" /></>,
    updated: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  }[kind];
  return <i className={`tracker-activity-icon activity-${kind}`} title={labels[kind]} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{mark}</svg></i>;
}
