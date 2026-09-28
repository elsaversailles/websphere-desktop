import type { TicketStatus } from '@websphere/shared';

/** Web-side copy of `ticketStatusLabels` in @websphere/shared (kept local so the browser bundle does not pull in zod); the Record type breaks the build if a status is added there without a label here. */
const statusLabels: Record<TicketStatus, string> = { pending: 'Ongoing', in_progress: 'In Progress', resolved: 'Completed', rejected: 'Declined' };
export const ticketStatusOptions = Object.keys(statusLabels) as TicketStatus[];
export const statusLabel = (status: string) => statusLabels[status as TicketStatus] ?? status.replaceAll('_', ' ');
export const categoryLabel = (category: string) => category.replaceAll('_', ' ');

export type SupportTicketRecord = { id: string; category: string; subject: string; body: string; status: TicketStatus; response: string | null; createdAt: string; updatedAt: string };
