# Task calendar integration and notifications

Tasks and assignments remain the source of truth. The calendar projects their due dates rather than creating a separate editable calendar event for each task.

| Requirement | Behavior |
| --- | --- |
| FR-01 | A dated task appears on its creator’s and active assignee’s calendars on the specified date. A former assignee no longer sees it unless they created it. Completed tasks remain visible as calendar history. Updating or removing a due date updates the calendar projection. |
| FR-02 | Assignment creates a `task_assignment` notification. Calendar displays up to five recent unread task assignment/deadline notifications. Selecting one opens its due date and marks the same notification read in the notification center. Undated assignments still produce a notification. |
| FR-03 | The existing push service sends the assignment notification to registered Expo mobile tokens and browser push subscriptions. No mobile registration or permission means no device delivery. |
| FR-04 | `/dashboard` uses the active-assignment task query, ordered by latest assignment so a newly assigned older task appears in its eight-task preview. The web dashboard refreshes on assignment notifications, task updates, and reconnection. |
| FR-05 | Every five minutes, the worker scans unfinished dated tasks. The responsible user receives a separate “due today” reminder on the due date. Active assignees are responsible; the creator is responsible while a task is unassigned. |
| FR-06 | Due-day reminders enter the email queue and are sent to the responsible user’s registered email address through the configured SES SMTP transport. |

Assignment notifications are triggered only by assignment/reassignment, independent of deadline reminders. Saving the same assignee or only changing the due date does not create another assignment notification.

## Timing and delivery

- Dates are calendar dates stored as UTC-midnight values. They are never shifted into the previous/next date based on the browser timezone.
- Reminder-day boundaries use `APP_TIME_ZONE`, defaulting to `Asia/Manila`. Scanning runs every five minutes, independently of whether a browser is open.
- Advance (“due tomorrow”), due-day, and overdue reminders have separate stable IDs per recipient, task, deadline, and calendar day. Repeated or concurrent scans reuse the persisted notification and queue job. An advance reminder cannot suppress a due-day reminder.
- Scheduled notifications are relayed by the API’s `notification-dispatch` worker to the existing websocket, mobile/browser push, and email channels. Completed dispatch jobs are retained for seven days to prevent repeated delivery during later scans. Failed scans/delivery jobs are retried.
- Before dispatch, reminders are checked against the current task: deleted/completed tasks, removed/changed due dates, and former assignees are skipped. A dispatch delayed into another calendar day is skipped.
- Existing task/email/push notification preferences apply. Mobile delivery requires a registered device token and OS notification permission; email delivery requires SMTP configuration.
- The reserved `apps/mobile` directory contains no mobile application implementation. This change verifies the existing Expo-token delivery backend, not a native mobile UI.

Deploy the API and worker together so the new dispatch queue has a consumer. No database migration is required. Existing administrator task alerts and project deadline reminders remain supported.

## Verification

Automated coverage is in API `calendar.spec.ts`, `task-changes.spec.ts`, `notification-email.spec.ts`, `notification-dispatch.service.spec.ts`, and `push.service.spec.ts`, plus worker `deadline-reminders.spec.ts` and `notification-email.spec.ts`.

The tests cover creator/assignee calendar scoping, due-date bounds, assignment delivery, long notification messages, due-day SMTP content, Manila midnight boundaries, repeated scans, retry after queue failure, reassignment, completed tasks, missing dates, and notification preferences. External Redis/MySQL/SMTP/device services are mocked; live email and device receipt still require deployment credentials and a registered device.
