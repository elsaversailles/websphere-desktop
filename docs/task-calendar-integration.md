# Task calendar integration and notifications

Tasks and assignments remain the source of truth. The calendar projects their due dates rather than creating a separate editable calendar event for each task.

| Requirement | Behavior |
| --- | --- |
| FR-01 | A dated task appears on its creator’s and active assignee’s calendars on the specified date. A former assignee no longer sees it unless they created it. Completed tasks remain visible as calendar history. Updating or removing a due date updates the calendar projection. |
| FR-02 | Assignment creates a `task_assignment` notification. Calendar displays up to five recent unread task assignment, deadline, and overdue notifications. Selecting one opens its due date and marks the same notification read in the notification center. Undated assignments still produce a notification. |
| FR-03 | The existing push service sends the assignment notification to registered Expo mobile tokens and browser push subscriptions. No mobile registration or permission means no device delivery. |
| FR-04 | `/dashboard` uses the active-assignment task query, ordered by latest assignment so a newly assigned older task appears in its eight-task preview. The web dashboard refreshes on assignment notifications, task updates, and reconnection. |
| FR-05 | At 10:00 AM and 8:00 PM Asia/Manila each day, the worker scans unfinished dated tasks, including deadlines more than a day away. The responsible user receives a reminder in each slot until the task is completed or its deadline is removed. Active assignees are responsible; the creator is responsible while a task is unassigned. |
| FR-06 | Due-day reminders enter the email queue and are sent to the responsible user’s registered email address through the configured SES SMTP transport. |
| FR-07 | Clicking anywhere in a calendar day opens one agenda dialog, including empty days. The dialog lists every agenda for that date, shows task projects and deadlines, and scrolls when needed. Day cells support keyboard activation and a red hover/focus outline. |
| FR-08 | Scheduled maintenance is projected from the saved system schedule, including its start time and announcement message. Rescheduling or cancellation updates the calendar without duplicate event rows. System schedules and Outlook entries are read-only; personal/team events remain editable from the agenda. |

Assignment notifications are triggered only by assignment/reassignment, independent of deadline reminders. Saving the same assignee or only changing the due date does not create another assignment notification.

## Timing and delivery

- Dates are calendar dates stored as UTC-midnight values. They are never shifted into the previous/next date based on the browser timezone.
- Reminder-day boundaries and the 10 AM / 8 PM cron schedule use `APP_TIME_ZONE`, defaulting to `Asia/Manila`. Scheduling is independent of whether a browser is open. Startup removes the previous hourly and five-minute schedules.
- Task reminders have stable IDs per recipient, task, calendar day, and morning/evening slot. Repeated or concurrent scans and due-date edits cannot produce duplicate slot IDs. The message names a future due date, says “due tomorrow” / “due today”, or warns that the task is overdue. Project deadline reminders remain once per day.
- Scheduled notifications are relayed by the API’s `notification-dispatch` worker to the existing websocket, mobile/browser push, and email channels. Completed dispatch jobs are retained for seven days to prevent repeated delivery during later scans. Failed scans/delivery jobs are retried.
- Before dispatch, reminders are checked against the current task: deleted/completed tasks, removed/changed due dates, and former assignees are skipped. A dispatch delayed into another calendar day or beyond its scheduled hour is skipped. The hour allows ordinary queue delays; a missed morning reminder is never replayed in the evening.
- Existing task/email/push notification preferences apply. Mobile delivery requires a registered device token and OS notification permission; email delivery requires SMTP configuration.
- The reserved `apps/mobile` directory contains no mobile application implementation. This change verifies the existing Expo-token delivery backend, not a native mobile UI.

The calendar heading is left aligned without a subtitle. Date clicks open the agenda instead of the New Event form; the separate New Event button remains available pending the user’s decision. Escape and Close dismiss the native modal and restore focus to the selected day. The selected month/year is a large bold label, navigated using Previous, Next, and Today instead of dropdowns.

Deploy the web client, API, and worker together. This calendar/reminder update adds no database migration; deploy any pending migrations from the separate task start-date change as usual. Existing administrator task alerts and project deadline reminders remain supported.

## Verification

Automated coverage is in API `calendar.spec.ts`, `task-changes.spec.ts`, `notification-email.spec.ts`, `notification-dispatch.service.spec.ts`, and `push.service.spec.ts`, plus worker `deadline-reminders.spec.ts` and `notification-email.spec.ts`, and web `calendar.spec.ts` for daily agenda grouping and date handling.

The tests cover creator/assignee calendar scoping, due-date bounds, assignment delivery, long notification messages, due-day SMTP content, Manila schedule calculations, separate 10 AM / 8 PM deliveries, future deadlines, repeated scans, retry after queue failure, reassignment, completed tasks, missing dates, and notification preferences. External Redis/MySQL/SMTP/device services are mocked; live email and device receipt still require deployment credentials and a registered device.
