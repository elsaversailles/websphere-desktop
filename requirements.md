# Requirements Document

## Introduction

WebSphere is a cross-platform academic project and idea management platform for college students, developed as a capstone project at STI College in San Jose Del Monte, Bulacan. The platform helps student teams move from raw ideas to completed academic projects by combining real-time group collaboration, structured idea selection, automated task and workflow tracking, AI-assisted ideation and tool recommendations, predictive project monitoring, and integrations with widely used productivity and design tools.

The system is divided into two functional areas defined by the capstone proposal: a **User Module** for project leaders and members, and a **Developers/Admin Module** for platform administration, monitoring, and account lifecycle management.

The current build targets the **web** platform and is architected **API-first** so that an Expo (React Native) mobile client can be added in a later phase without re-implementing business logic. Locked technical decisions include a React (Vite) single-page application, a Node.js/NestJS REST API, Socket.IO 4.7+ for real-time features backed by a Redis adapter, MySQL 8 accessed through Prisma ORM, background jobs via BullMQ/Redis, notifications through in-app channels, AWS SES email, and VAPID web push, and an OpenAI-based AI assistant using retrieval-augmented generation (RAG), function calling, and the Model Context Protocol (MCP) with academic-only guardrails and content moderation. The platform is deployed on AWS Lightsail using Docker.

This document specifies the end-to-end requirements for the full WebSphere system across 13 epics and 75 user stories (US-001 through US-075), the platform-wide non-functional requirements, and the out-of-scope limitations inherited from the capstone proposal.

## Glossary

- **WebSphere**: The academic project and idea management platform specified by this document.
- **Administrator (Developer Module)**: A privileged user who operates the Developers/Admin Module, responsible for system monitoring, account lifecycle management, logs, and system configuration.
- **Project_Leader**: A user role authorized to create projects, manage project membership removals, assign tasks, and configure project settings.
- **Project_Member**: A user role that participates in a project, collaborates in the group, works on assigned tasks, and contributes ideas.
- **Group**: A collaboration space that a set of users join (via a join code) to communicate, share ideas, and form the basis of a project.
- **Join_Code**: A shareable code that lets a user join an existing group, modeled on the Google Meet joining-code flow.
- **Idea_Poll**: An in-group-chat voting mechanism, styled like Meta Messenger polls, used to collect and rank candidate ideas so a team can select a winning idea.
- **Collaboration_Hub**: The combined real-time chat, idea polling, and file/tool space where a group coordinates work, with retained message history.
- **Workflow_Recording**: The automatic capture of project and task activity (status changes, completions, progress changes, and user activity) without manual tracking.
- **Predictive_Monitoring**: The analytics capability that projects completion dates, risk, and bottlenecks from workflow data and task completion.
- **Risk_Score**: A quantitative value derived from workflow and task data that expresses the likelihood a project or task will miss its deadline.
- **Risk_Level**: A categorical classification derived from the Risk_Score, one of on-track, at-risk, or critical.
- **Blast_Radius**: A quantitative impact measure describing how many dependent tasks, members, or milestones a given bottleneck affects.
- **Connected_Tool**: An external productivity or design service that a user links through OAuth2 (Google Drive/Docs, Microsoft 365 via Graph, Trello, Asana, Canva, or Figma).
- **RAG (Retrieval-Augmented Generation)**: The technique by which the AI assistant retrieves grounded context (including the current WebSphere tools catalog) before generating responses.
- **MCP (Model Context Protocol)**: The protocol used to expose WebSphere data and functions to the AI assistant in a controlled way.
- **@helper**: The invocation keyword used inside collaboration surfaces to summon the WebSphere AI assistant.
- **Tools_Catalog**: The current, system-maintained list of tools and integrations that WebSphere supports; the AI assistant is grounded in this catalog so its recommendations are valid.
- **JWT**: JSON Web Token; the access/refresh token scheme used for authenticated API access.

## Requirements

## Epic 1: Account Access and Profile

### Requirement 1: User registration (US-001)

**User Story:** As a student, I want to register an account, so that I can use WebSphere.

#### Acceptance Criteria

1. WHEN a student submits the registration form with valid personal, academic, and account information, THE WebSphere_System SHALL create a Project_Member account and persist it to the database.
2. IF a student submits the registration form with missing required personal, academic, or account values, THEN THE WebSphere_System SHALL reject the submission and identify the missing fields.
3. IF a student submits an invalid value in any registration field, THEN THE WebSphere_System SHALL reject the submission and describe the invalid value.
4. IF a student submits a registration email that already belongs to an existing account, THEN THE WebSphere_System SHALL reject the registration and return a message that the email is already in use.

### Requirement 2: User login (US-002)

**User Story:** As a registered student, I want to log in using my credentials, so that I can access my academic workspace.

#### Acceptance Criteria

1. WHEN a registered student submits valid credentials, THE WebSphere_System SHALL authenticate the student and issue a JWT access token and refresh token.
2. IF a student submits invalid credentials, THEN THE WebSphere_System SHALL deny access and return an invalid-credentials message.
3. IF a student submits the login form with missing required fields, THEN THE WebSphere_System SHALL reject the submission and identify the missing fields.
4. WHEN authentication succeeds, THE WebSphere_System SHALL route the student to the academic workspace that corresponds to the student's role.

### Requirement 3: Administrator login (US-003)

**User Story:** As an administrator, I want to log in through the administrator portal, so that I can access system-management functions.

#### Acceptance Criteria

1. WHEN an Administrator submits valid administrator credentials through the administrator portal, THE WebSphere_System SHALL authenticate the Administrator and grant access to system-management functions.
2. IF credentials submitted through the administrator portal do not belong to an authorized Administrator, THEN THE WebSphere_System SHALL deny access and return an authorization error.
3. WHEN administrator authentication succeeds, THE WebSphere_System SHALL route the Administrator to the Developers/Admin Module.

### Requirement 4: Role-based access (US-004)

**User Story:** As an authenticated user, I want access based on my assigned role, so that I can only perform authorized actions.

#### Acceptance Criteria

1. THE WebSphere_System SHALL assign every account exactly one primary role from Administrator, Project_Leader, and Project_Member.
2. IF an authenticated user requests an action outside the permissions of the assigned role, THEN THE WebSphere_System SHALL deny the action and return an authorization error.
3. WHEN a user's assigned role changes, THE WebSphere_System SHALL apply the updated permissions on the next authenticated request.

### Requirement 5: Profile management (US-005)

**User Story:** As a student, I want to view and edit my profile, so that my personal and academic information remains accurate.

#### Acceptance Criteria

1. WHEN a student opens the profile page, THE WebSphere_System SHALL display the student's name, email, institution, course, and profile image.
2. WHEN a student submits valid edits to name, email, institution, course, or profile image, THE WebSphere_System SHALL persist the updated information and confirm the change.
3. IF a student submits profile edits that fail validation, THEN THE WebSphere_System SHALL reject the change and identify the invalid fields.

### Requirement 6: Password management (US-006)

**User Story:** As a user, I want to change my password, so that I can maintain account security.

#### Acceptance Criteria

1. WHEN a user sets or changes a password, THE WebSphere_System SHALL require a minimum of 8 characters that include at least one symbol and at least one number arranged in a non-continuous way.
2. IF a submitted password contains a continuous sequence such as "AbCd1234", THEN THE WebSphere_System SHALL reject the password and explain the sequence restriction.
3. WHILE a user is authenticated and not locked out, THE WebSphere_System SHALL provide a guided reset interface that requires the existing password and the new password entered twice for validation.
4. IF the existing password entered in the guided reset is incorrect, THEN THE WebSphere_System SHALL reject the change and return an incorrect-password message.
5. IF a user is locked out of the account, THEN THE WebSphere_System SHALL send a password reset link to the registered email as the only reset path.
6. THE WebSphere_System SHALL NOT require two-factor authentication for password change or reset.

### Requirement 7: Logout (US-007)

**User Story:** As an authenticated user, I want to log out, so that my session is safely ended.

#### Acceptance Criteria

1. WHEN a student or an Administrator logs out, THE WebSphere_System SHALL invalidate the active session and associated refresh token.
2. WHEN a student or an Administrator logs out, THE WebSphere_System SHALL invalidate cached session data for that account.
3. IF an API request presents an invalidated token after logout, THEN THE WebSphere_System SHALL reject the request as unauthenticated.

## Epic 2: Dashboard

### Requirement 8: Academic dashboard summary (US-008)

**User Story:** As a student, I want a dashboard summary, so that I can quickly understand my current academic workload.

#### Acceptance Criteria

1. WHEN a student opens the dashboard, THE WebSphere_System SHALL display a summary that includes recent projects, the student's tasks, a calendar of events, upcoming deadlines, team activity, a Project Progress Overview, announcements, and Milestones & Achievements.
2. WHEN a student opens the dashboard, THE WebSphere_System SHALL display online users limited to the student's project group only.
3. WHEN a student opens the dashboard, THE WebSphere_System SHALL display glance counts for active project count, pending tasks count, and ideas submitted count.
4. WHEN the underlying projects, tasks, ideas, or events change, THE WebSphere_System SHALL update the dashboard summary to reflect the current data.

### Requirement 9: Recent project overview (US-009)

**User Story:** As a student, I want to view my recent projects, so that I can quickly return to active academic work.

#### Acceptance Criteria

1. WHEN a student opens the My Projects section, THE WebSphere_System SHALL display the student's recent projects.
2. THE WebSphere_System SHALL display, for each recent project, its group, deadline, progress, and status.
3. WHEN a student selects a recent project, THE WebSphere_System SHALL open that project's details.

### Requirement 10: Assigned-task overview (US-010)

**User Story:** As a student, I want to view my assigned tasks on the dashboard, so that I can prioritize.

#### Acceptance Criteria

1. WHEN a student opens the dashboard, THE WebSphere_System SHALL display the tasks assigned to the student.
2. THE WebSphere_System SHALL display, for each assigned task, its deadline, priority, status, and progress.

### Requirement 11: Upcoming deadlines and activity (US-011)

**User Story:** As a student, I want upcoming deadlines, alerts, and recent activity, so that I do not miss important events.

#### Acceptance Criteria

1. WHEN a student opens the dashboard, THE WebSphere_System SHALL display upcoming deadline previews, important notifications, and recent collaboration activity together.
2. WHEN a new deadline, notification, or collaboration activity occurs, THE WebSphere_System SHALL update the displayed previews.

## Epic 3: Groups and Collaboration

### Requirement 12: Create or join a group (US-012)

**User Story:** As a student, I want to create or join a project group, so that I can collaborate with classmates.

#### Acceptance Criteria

1. WHEN a student creates a Group, THE WebSphere_System SHALL create the Group and generate a unique Join_Code modeled on the Google Meet joining-code flow.
2. WHEN a student submits a valid Join_Code, THE WebSphere_System SHALL add the student to the corresponding Group.
3. IF a student submits an invalid or expired Join_Code, THEN THE WebSphere_System SHALL reject the request and return an invalid-code message.
4. THE WebSphere_System SHALL allow a student to participate in multiple Groups.

### Requirement 13: View my groups and roles (US-013)

**User Story:** As a student, I want to view all my groups and my role in each, so that I can distinguish leader vs member.

#### Acceptance Criteria

1. WHEN a student opens the groups list, THE WebSphere_System SHALL display all Groups the student belongs to.
2. THE WebSphere_System SHALL display, for each listed Group, the student's membership and role as Project_Leader or Project_Member.

### Requirement 14: View group details (US-014)

**User Story:** As a group member, I want to view group details, so that I can see members, roles, projects, and activity in one place.

#### Acceptance Criteria

1. WHEN a Group member opens the Group details, THE WebSphere_System SHALL display the members, roles, projects, group activity, project progress, and recent activities.
2. THE WebSphere_System SHALL restrict Group details access to members of the corresponding Group.

### Requirement 15: Manage group members (US-015)

**User Story:** As a project leader, I want to add or remove group members, so that group membership is managed correctly.

#### Acceptance Criteria

1. WHEN any Group member adds a new user to the Group, THE WebSphere_System SHALL add that user as a Project_Member.
2. WHEN an authorized Project_Leader removes a member, THE WebSphere_System SHALL remove that member from the Group and revoke the member's Group access.
3. IF a user who is not an authorized Project_Leader attempts to remove a member, THEN THE WebSphere_System SHALL deny the removal.

### Requirement 16: Real-time group chat (US-016)

**User Story:** As a group member, I want to send and receive messages in real time, so that the team can communicate synchronously and review past discussion.

#### Acceptance Criteria

1. WHEN a Group member sends a message, THE WebSphere_System SHALL deliver the message in real time to all connected Group members through the websocket connection.
2. THE WebSphere_System SHALL retain Group message history and display it when a member reopens the Group chat.
3. WHERE the audio and video call feature is enabled, THE WebSphere_System SHALL establish real-time WebRTC audio and video sessions between Group members as a later extension.

### Requirement 17: Group collaboration hub (US-017)

**User Story:** As a group member, I want to access projects, tasks, ideas, voting, and chat from one group workspace, so that all coordination happens in a central place.

#### Acceptance Criteria

1. WHEN a Group member opens the Collaboration_Hub, THE WebSphere_System SHALL provide access to the Group's projects, tasks, ideas, voting, and chat from a single workspace per project group.
2. THE WebSphere_System SHALL restrict Collaboration_Hub access to members of the corresponding Group.

### Requirement 18: Begin the selected project idea (US-018)

**User Story:** As a project leader, I want to begin a project from the group's selected idea, so that the winning idea becomes the basis of the academic project.

#### Acceptance Criteria

1. WHEN a Project_Leader begins a project from the Group's winning idea, THE WebSphere_System SHALL create the project using the winning idea from the group chat poll as its basis.
2. THE WebSphere_System SHALL preserve the relationship between the selected idea and the resulting project.

## Epic 4: Project Management

### Requirement 19: Create a project (US-019)

**User Story:** As a project leader, I want to create an academic project, so that the team has a defined project to work on.

#### Acceptance Criteria

1. WHEN a Project_Leader creates a project with a title, description, members, dates, and deadline, THE WebSphere_System SHALL create the project and associate the provided members.
2. WHERE optional external tools are provided during creation, THE WebSphere_System SHALL associate the selected external tools with the project.
3. THE WebSphere_System SHALL make project creation available from both the My Projects section and the Dashboard.
4. WHEN a project is created, THE WebSphere_System SHALL assign the creator the Project_Leader role for that project.

### Requirement 20: View all projects (US-020)

**User Story:** As a student, I want to view all projects I belong to, so that I can navigate to the right one.

#### Acceptance Criteria

1. WHEN a student opens the projects list, THE WebSphere_System SHALL display all projects the student belongs to.
2. THE WebSphere_System SHALL display, for each project, its group, the student's role, progress, deadline, and status.

### Requirement 21: View project details (US-021)

**User Story:** As a project member, I want complete project information, so that I understand the project fully.

#### Acceptance Criteria

1. WHEN a Project_Member opens the primary project-detail screen, THE WebSphere_System SHALL display the project scope, dates, members, status, and progress.
2. THE WebSphere_System SHALL restrict project-detail access to members of that project.

### Requirement 22: Edit project information (US-022)

**User Story:** As a project leader, I want to edit project info, so that the project record stays current.

#### Acceptance Criteria

1. WHEN a Project_Leader submits valid edits to the project title, description, dates, or other settings, THE WebSphere_System SHALL persist the changes and confirm them.
2. IF a Project_Member attempts to edit protected project information, THEN THE WebSphere_System SHALL deny the change.

### Requirement 23: Manage project deadline and status (US-023)

**User Story:** As a project leader, I want to manage the deadline and status, so that the project reflects its current state.

#### Acceptance Criteria

1. WHEN a Project_Leader sets or updates the project deadline, THE WebSphere_System SHALL store the deadline and display it in the My Projects section.
2. WHEN a Project_Leader sets the project status, THE WebSphere_System SHALL record the status as active, completed, or another approved state.

### Requirement 24: View team responsibilities (US-024)

**User Story:** As a project member, I want to view the project team and assigned responsibilities, so that I know who is responsible for each part.

#### Acceptance Criteria

1. WHEN a Project_Member opens the team view, THE WebSphere_System SHALL display the project team and each member's assigned responsibilities.
2. WHEN responsibilities change, THE WebSphere_System SHALL update the displayed team responsibilities.

### Requirement 25: Monitor overall project progress (US-025)

**User Story:** As a project leader, I want to monitor project progress, so that I can see if the group is on track.

#### Acceptance Criteria

1. THE WebSphere_System SHALL compute overall project progress from task completion and Workflow_Recording information through the predictive workflow function.
2. WHEN task completion or workflow information changes, THE WebSphere_System SHALL recompute overall project progress.
3. WHEN a Project_Leader opens the project progress view, THE WebSphere_System SHALL display whether the group is on track based on the computed progress.

## Epic 5: Task Management and Progress

### Requirement 26: Create and edit tasks (US-026)

**User Story:** As a project leader, I want to create and edit tasks, so that work can be organized.

#### Acceptance Criteria

1. WHEN a Project_Leader creates a task with a title, description, deadline, and priority, THE WebSphere_System SHALL add the task to the project.
2. WHEN a Project_Leader submits valid edits to a task, THE WebSphere_System SHALL persist the changes and confirm them.

### Requirement 27: Assign and reassign tasks (US-027)

**User Story:** As a project leader, I want to assign or reassign tasks to members, so that responsibilities are clear.

#### Acceptance Criteria

1. WHEN a Project_Leader assigns a task to an eligible Project_Member, THE WebSphere_System SHALL record the assignment and notify the assignee.
2. WHEN a Project_Leader reassigns a task, THE WebSphere_System SHALL update the assignee and notify the affected members.
3. IF a Project_Leader attempts to assign a task to a user who is not an eligible project member, THEN THE WebSphere_System SHALL deny the assignment.

### Requirement 28: View assigned tasks (US-028)

**User Story:** As a project member, I want to view all tasks assigned to me, so that I can manage my work.

#### Acceptance Criteria

1. WHEN a Project_Member opens the assigned-tasks view, THE WebSphere_System SHALL display all tasks assigned to the member.
2. WHEN a Project_Member searches or organizes the assigned tasks by project, deadline, priority, or status, THE WebSphere_System SHALL display the tasks in the selected arrangement.

### Requirement 29: View task details (US-029)

**User Story:** As a project member, I want complete task details, so that context stays with the task.

#### Acceptance Criteria

1. WHEN a Project_Member opens a task, THE WebSphere_System SHALL display the task description, project, assigned member, assigner, deadline, priority, status, and progress.
2. THE WebSphere_System SHALL restrict task-detail access to members of the associated project.

### Requirement 30: Update task status (US-030)

**User Story:** As an assigned member, I want to update a task's status, so that progress is reflected accurately.

#### Acceptance Criteria

1. WHEN an assigned member changes a task status to pending, ongoing, or completed, THE WebSphere_System SHALL persist the new status.
2. WHEN a task status changes, THE WebSphere_System SHALL record the status change.

### Requirement 31: Update task progress — DEPRECATED / EXCLUDED (US-031)

**User Story:** As an assigned member, I want to update the task progress percentage, so that my current work is represented — NOTE: this story is deprecated and explicitly excluded from scope.

#### Acceptance Criteria

1. THE WebSphere_System SHALL NOT provide any interface or API for manual entry of a task progress percentage.
2. THE WebSphere_System SHALL derive task and project progress automatically from task completion and Workflow_Recording data (see US-032 and US-033) rather than manual percentage entry.

### Requirement 32: Task progress tracker (US-032)

**User Story:** As a project member, I want a task progress tracker, so that I can see completed, ongoing, and pending work.

#### Acceptance Criteria

1. WHEN a Project_Member opens the task progress tracker, THE WebSphere_System SHALL display completed, ongoing, and pending work.
2. THE WebSphere_System SHALL display task counts and progress percentages in the task progress tracker.

### Requirement 33: Automatic workflow recording (US-033)

**User Story:** As a project member, I want task changes recorded automatically, so that the group needs no separate manual tracker.

#### Acceptance Criteria

1. WHEN a task status changes, THE WebSphere_System SHALL record the change automatically in Workflow_Recording through the external MCP or API capability.
2. WHEN a task is completed, THE WebSphere_System SHALL record the completion automatically in Workflow_Recording.
3. WHEN task progress or user activity changes, THE WebSphere_System SHALL record the activity automatically in Workflow_Recording.
4. THE WebSphere_System SHALL NOT require any manual workflow tracking by the group.

### Requirement 34: Task analytics by member (US-034)

**User Story:** As a project leader, I want completed, ongoing, and pending tasks for each member, so that I can assess individual workload and contribution.

#### Acceptance Criteria

1. WHEN a Project_Leader opens the member task analytics, THE WebSphere_System SHALL display the completed, ongoing, and pending tasks for each member.
2. THE WebSphere_System SHALL derive the member task analytics from task and progress data.

### Requirement 35: Real-time task updates (US-035)

**User Story:** As a project member, I want task changes to appear in real time without refreshing, so that I always see the current state.

#### Acceptance Criteria

1. WHEN a task status or progress changes, THE WebSphere_System SHALL push the update to all connected project members through the websocket connection without a page refresh.
2. IF a member's real-time connection drops, THEN THE WebSphere_System SHALL reconcile the current task state when the connection is restored.

## Epic 6: Idea Management and Voting

### Requirement 36: Submit an idea (US-036)

**User Story:** As a group member, I want to submit a project idea, so that it can be considered by the team.

#### Acceptance Criteria

1. WHEN a Group member submits a project idea, THE WebSphere_System SHALL store the idea within the relevant group or project workspace.
2. THE WebSphere_System SHALL restrict idea submission to members of the corresponding Group.

### Requirement 37: View stored ideas (US-037)

**User Story:** As a group member, I want to view all submitted ideas, so that I can review the team's options.

#### Acceptance Criteria

1. WHEN a Group member opens the ideas list, THE WebSphere_System SHALL display all submitted ideas.
2. THE WebSphere_System SHALL display, for each idea, its author and current status.

### Requirement 38: Edit and refine an idea (US-038)

**User Story:** As an idea author, I want to edit and refine my idea before selection, so that it is as strong as possible.

#### Acceptance Criteria

1. WHEN an authorized idea author submits a revision before selection, THE WebSphere_System SHALL save the revised idea.
2. IF a user who is not authorized attempts to edit an idea, THEN THE WebSphere_System SHALL deny the change.

### Requirement 39: Request AI suggestions for an idea (US-039)

**User Story:** As an idea author, I want AI-generated suggestions to improve my idea, so that it becomes more relevant, clear, and feasible.

#### Acceptance Criteria

1. WHEN an idea author summons the AI with @helper for suggestions, THE WebSphere_System SHALL generate suggestions to improve the relevance, clarity, and feasibility of the idea using the idea and project context.
2. THE WebSphere_System SHALL NOT process multimodal inputs when generating idea suggestions.

### Requirement 40: Review AI suggestions (US-040)

**User Story:** As an idea author, I want to accept, reject, or revise AI suggestions, so that I remain responsible for the final content.

#### Acceptance Criteria

1. WHEN the AI presents a suggestion, THE WebSphere_System SHALL provide accept, reject, and revise actions.
2. THE WebSphere_System SHALL NOT automatically replace the author's idea with an AI suggestion.
3. WHEN an author accepts, rejects, or revises a suggestion, THE WebSphere_System SHALL apply only the action the author selected.

### Requirement 41: Vote on ideas (US-041)

**User Story:** As a group member, I want to vote on submitted ideas, so that the team can converge on one direction.

#### Acceptance Criteria

1. WHEN an eligible Group member casts a vote on a submitted idea, THE WebSphere_System SHALL record the vote.
2. IF a user who is not an eligible group member attempts to vote, THEN THE WebSphere_System SHALL deny the vote.

### Requirement 42: View voting results (US-042)

**User Story:** As a group member, I want to view vote totals and results transparently, so that the outcome is clear to everyone.

#### Acceptance Criteria

1. WHEN a Group member opens the voting results, THE WebSphere_System SHALL display the vote totals and results.
2. WHEN a vote is submitted, THE WebSphere_System SHALL update the displayed results.

### Requirement 43: Finalize the winning idea (US-043)

**User Story:** As a project leader, I want to finalize the winning idea and convert it into a project, so that the team's decision drives the work.

#### Acceptance Criteria

1. WHEN a Project_Leader finalizes the winning idea from the group chat poll, THE WebSphere_System SHALL convert the winning idea into a project.
2. THE WebSphere_System SHALL preserve the relationship between the selected idea and the resulting project.

## Epic 7: AI Assistant

### Requirement 44: Ask the AI assistant (US-044)

**User Story:** As a student, I want to ask the AI assistant project-related questions, so that I receive contextual academic guidance.

#### Acceptance Criteria

1. WHEN a student submits a free-form project question to the AI assistant, THE WebSphere_System SHALL return contextual academic guidance.
2. THE WebSphere_System SHALL apply guardrails that keep the AI assistant inline with an academic setting.
3. IF a question is outside the academic setting, THEN THE WebSphere_System SHALL refuse and return a safe explanation.

### Requirement 45: Generate academic project ideas (US-045)

**User Story:** As a student, I want the AI to generate project ideas based on my course or selected category, so that I have appropriate starting points.

#### Acceptance Criteria

1. WHEN a student requests generated ideas for a course or selected category, THE WebSphere_System SHALL generate grounded project ideas appropriate for an academic project.
2. WHEN a student requests it, THE WebSphere_System SHALL merge multiple ideas into one.

### Requirement 46: Receive feature and tool recommendations (US-046)

**User Story:** As a student, I want the AI to recommend system features and suitable external tools, so that I can work more effectively.

#### Acceptance Criteria

1. WHEN a student requests recommendations, THE WebSphere_System SHALL recommend WebSphere features and suitable external tools.
2. THE WebSphere_System SHALL ground external-tool recommendations in the current Tools_Catalog so that each recommendation is valid.
3. THE WebSphere_System SHALL be able to include technologies, productivity tools, and functionalities in recommendations.

### Requirement 47: Receive planning and decision guidance (US-047)

**User Story:** As a student, I want AI task-planning, workflow, and decision-making guidance, so that I can plan and choose effectively.

#### Acceptance Criteria

1. WHEN a student requests planning guidance, THE WebSphere_System SHALL provide task-planning and workflow guidance including task suggestions.
2. WHEN a student requests decision guidance, THE WebSphere_System SHALL provide support for evaluating project options.

## Epic 8: Calendar and Scheduling

### Requirement 48: View and navigate the calendar (US-048)

**User Story:** As a student, I want to view and navigate a calendar by date, so that I can see my schedule over time.

#### Acceptance Criteria

1. WHEN a student opens the calendar, THE WebSphere_System SHALL display the calendar organized by date.
2. WHEN a student navigates between periods, THE WebSphere_System SHALL display the selected period.
3. WHEN a student chooses to return to the current date, THE WebSphere_System SHALL display the period containing the current date.

### Requirement 49: Display project and task dates (US-049)

**User Story:** As a student, I want project deadlines and task timelines on the calendar, so that I can see them alongside my events.

#### Acceptance Criteria

1. WHEN a student views the calendar, THE WebSphere_System SHALL display project deadlines and task timelines as colored, clickable hints.
2. WHEN a project deadline or task timeline changes, THE WebSphere_System SHALL reflect the change on the calendar automatically.

### Requirement 50: Create a calendar event (US-050)

**User Story:** As a student, I want to create a calendar event, so that I can schedule meetings, work sessions, presentations, and activities.

#### Acceptance Criteria

1. WHEN a student creates a calendar event through the calendar, THE WebSphere_System SHALL store the event for meetings, work sessions, presentations, or activities.
2. WHERE a project is selected for the event, THE WebSphere_System SHALL associate the event with that project.

### Requirement 51: Manage calendar events (US-051)

**User Story:** As a student, I want to edit and remove calendar events, so that my schedule stays accurate.

#### Acceptance Criteria

1. WHEN a student submits valid edits to a calendar event, THE WebSphere_System SHALL persist the changes and confirm them.
2. WHEN a student removes a calendar event, THE WebSphere_System SHALL delete the event from the calendar.
3. IF a user who is not authorized attempts to modify a project-related event, THEN THE WebSphere_System SHALL deny the modification.

### Requirement 52: View upcoming schedules (US-052)

**User Story:** As a student, I want to view upcoming events and deadlines, so that I can prepare in advance.

#### Acceptance Criteria

1. WHEN a student opens the upcoming schedules view, THE WebSphere_System SHALL display upcoming events and deadlines with date, project, and urgency.
2. WHEN a project deadline is upcoming or has lapsed, THE WebSphere_System SHALL notify the student through push notification and email.

## Epic 9: Workflow Analytics and Predictive Monitoring

### Requirement 53: Workflow analytics dashboard (US-053)

**User Story:** As a project member, I want a workflow analytics dashboard, so that I can understand project performance at a glance.

#### Acceptance Criteria

1. WHEN a Project_Member opens the workflow analytics dashboard, THE WebSphere_System SHALL display charts, indicators, and summaries.
2. THE WebSphere_System SHALL include Overall Efficiency, Bottlenecks Detected, Tasks Completed, task completion rate, team member performance, bottleneck analysis, connected tool usage, and a workflow summary in the workflow analytics dashboard.

### Requirement 54: View progress and completion trends (US-054)

**User Story:** As a project member, I want task-completion and project-progress trends, so that I can see if productivity is improving or declining.

#### Acceptance Criteria

1. WHEN a Project_Member opens the trends view, THE WebSphere_System SHALL display task-completion and project-progress trends.
2. THE WebSphere_System SHALL compare progress across relevant periods in the trends view.

### Requirement 55: View member performance (US-055)

**User Story:** As a project leader, I want member-performance information, so that I can see workload and contribution differences.

#### Acceptance Criteria

1. WHEN a Project_Leader opens the member-performance view, THE WebSphere_System SHALL display workload and contribution differences using quantitative KPIs.
2. THE WebSphere_System SHALL derive member-performance information from task and progress data.

### Requirement 56: Identify workflow bottlenecks (US-056)

**User Story:** As a project leader, I want to view workflow bottlenecks, so that I can see what is slowing the project.

#### Acceptance Criteria

1. WHEN a Project_Leader opens the bottleneck view, THE WebSphere_System SHALL display workflow bottlenecks slowing the project.
2. THE WebSphere_System SHALL include a Blast_Radius impact KPI and MAY include expected time, actual time, delay, and impact for each bottleneck.

### Requirement 57: View workflow summaries (US-057)

**User Story:** As a project member, I want workflow summaries and recommended actions, so that analytics translate into next steps.

#### Acceptance Criteria

1. WHEN a Project_Member opens the workflow summary, THE WebSphere_System SHALL display a summary and recommended actions.
2. THE WebSphere_System SHALL derive the workflow summary from current project information.

### Requirement 58: Detect delay risks (US-058)

**User Story:** As a project member, I want the system to identify delayed or at-risk work early, so that the team can respond in time.

#### Acceptance Criteria

1. THE WebSphere_System SHALL analyze deadlines, task status, completion rates, and progress to identify delayed or at-risk work through Predictive_Monitoring.
2. THE WebSphere_System SHALL base delay-risk detection on grounded KPIs.

### Requirement 59: View risk indicators (US-059)

**User Story:** As a project member, I want risk counts, scores, and levels, so that I can determine which tasks need immediate attention.

#### Acceptance Criteria

1. WHEN a Project_Member opens the risk indicators view, THE WebSphere_System SHALL display risk counts, Risk_Score values, and Risk_Level classifications.
2. THE WebSphere_System SHALL distinguish on-track work from at-risk work through the Risk_Level.

### Requirement 60: View predicted completion information (US-060)

**User Story:** As a project member, I want to compare the original deadline with the predicted completion date, so that I understand the risk and its causes.

#### Acceptance Criteria

1. WHEN a Project_Member opens the predicted completion view, THE WebSphere_System SHALL display the original deadline, the predicted completion date, and an explanation.
2. THE WebSphere_System SHALL identify the factors contributing to the risk in the prediction.

### Requirement 61: View corrective recommendations (US-061)

**User Story:** As a project leader, I want recommended corrective actions, so that I can respond to possible delays.

#### Acceptance Criteria

1. WHEN a Project_Leader opens the corrective recommendations view, THE WebSphere_System SHALL display recommended corrective actions to respond to possible delays.
2. THE WebSphere_System SHALL be able to recommend adjusting deadlines, reassigning work, adding support, or scheduling a review.

## Epic 10: Notifications

### Requirement 62: Notification center (US-062)

**User Story:** As a student, I want a notification center, so that I can review important project and system events in one place.

#### Acceptance Criteria

1. WHEN a student opens the mobile-based notification center, THE WebSphere_System SHALL display important project and system events in one place.
2. THE WebSphere_System SHALL display, for each notification, its message, timestamp, type, and read status.

### Requirement 63: In-app project notifications (US-063)

**User Story:** As a student, I want in-app notifications, so that I stay aware of project changes and group activity.

#### Acceptance Criteria

1. WHEN a task assignment, task update, project change, group activity, or announcement occurs, THE WebSphere_System SHALL deliver an in-app notification to the affected student.
2. WHERE a related record exists, THE WebSphere_System SHALL direct the student to that record from the notification.

### Requirement 64: Deadline and predictive alerts (US-064)

**User Story:** As a student, I want deadline reminders and delay-risk alerts, so that I can act before work is overdue.

#### Acceptance Criteria

1. WHEN a deadline is approaching, THE WebSphere_System SHALL send a deadline reminder to the affected student.
2. WHEN Predictive_Monitoring identifies delay risk, THE WebSphere_System SHALL send a delay-risk alert indicating the urgency and the affected task or project.

### Requirement 65: Email and mobile notifications (US-065)

**User Story:** As a student, I want email and mobile notifications, so that I stay informed even when WebSphere is not open.

#### Acceptance Criteria

1. WHILE WebSphere is not open, THE WebSphere_System SHALL deliver supported notification types through email and mobile notifications.
2. THE WebSphere_System SHALL apply email and mobile delivery to supported notification types.

### Requirement 66: Notification preferences (US-066)

**User Story:** As a student, I want to manage notification preferences, so that I control which alert types I receive.

#### Acceptance Criteria

1. WHEN a student updates notification preferences, THE WebSphere_System SHALL persist which alert types the student receives.
2. THE WebSphere_System SHALL allow preferences to cover tasks, deadlines, group activities, and AI-related suggestions.

## Epic 11: Apps and External Tools

### Requirement 67: Browse and connect external tools (US-067)

**User Story:** As a student, I want to browse and connect supported external tools, so that I can use them with WebSphere.

#### Acceptance Criteria

1. WHEN a student opens the external tools catalog, THE WebSphere_System SHALL display the supported tools including Canva, Figma, MS 365 (Word, Excel, PowerPoint), Google Drive, Google Docs, Trello, and Asana.
2. WHEN a student connects a supported external tool, THE WebSphere_System SHALL establish the connection through MCP or API.
3. THE WebSphere_System SHALL be able to include collaboration, file-management, communication, and academic-work applications in the catalog.

### Requirement 68: Link and launch external tools (US-068)

**User Story:** As a student, I want to link an external tool or activity to a project or task and launch it from WebSphere, so that my work stays connected.

#### Acceptance Criteria

1. WHEN a student links an external tool or activity to a project or task, THE WebSphere_System SHALL record the connection and identify the relevant project or task.
2. WHEN a student launches a linked external tool from WebSphere, THE WebSphere_System SHALL open the tool in the context of the linked project or task.

### Requirement 69: Synchronize external-tool information (US-069)

**User Story:** As a student, I want to view connection status, synchronization activity, and available progress information, so that I can track connected tool usage.

#### Acceptance Criteria

1. WHEN a student opens a Connected_Tool view, THE WebSphere_System SHALL display the connection status, synchronization activity, and available progress information.
2. THE WebSphere_System SHALL determine the synchronized information based on the supported integration.

## Epic 12: Support and Ticketing

### Requirement 70: Submit a support ticket (US-070)

**User Story:** As a user, I want to submit a categorized support request, so that I can get help with an issue.

#### Acceptance Criteria

1. WHEN a user submits a support ticket, THE WebSphere_System SHALL store the ticket with a category of account reactivation, account deletion, password concern, bug report, or other concerns.
2. IF a user submits a support ticket without a category, THEN THE WebSphere_System SHALL reject the submission and require a category.

### Requirement 71: Process support tickets (US-071)

**User Story:** As an administrator, I want to review, respond to, update, and resolve support tickets, so that user issues are handled.

#### Acceptance Criteria

1. WHEN an Administrator reviews or responds to a support ticket, THE WebSphere_System SHALL record the response.
2. WHEN an Administrator updates a ticket status, THE WebSphere_System SHALL set the status to pending, in progress, resolved, or rejected.

## Epic 13: Administrator Operations

### Requirement 72: Monitor system operations (US-072)

**User Story:** As an administrator, I want dashboard metrics, user activity, active projects, and system health, so that I can monitor operations.

#### Acceptance Criteria

1. WHEN an Administrator opens the monitoring dashboard, THE WebSphere_System SHALL display dashboard metrics, user activity, active projects, and system health.
2. THE WebSphere_System SHALL include relevant activity and availability indicators in the monitoring dashboard.

### Requirement 73: Manage user accounts (US-073)

**User Story:** As an administrator, I want to view, edit, deactivate, remove, reactivate, and suspend user accounts, so that access is properly controlled.

#### Acceptance Criteria

1. WHEN an Administrator views or edits a user account, THE WebSphere_System SHALL display or persist the account information.
2. WHEN an Administrator deactivates, removes, reactivates, or suspends a user account, THE WebSphere_System SHALL apply the requested change to the account's access.
3. WHERE reactivation is based on an approved support request, THE WebSphere_System SHALL reactivate the account.

### Requirement 74: Review system and audit logs (US-074)

**User Story:** As an administrator, I want to review system and activity logs, so that I can investigate errors, monitor important actions, and support auditing.

#### Acceptance Criteria

1. WHEN an Administrator opens the logs view, THE WebSphere_System SHALL display system and activity logs.
2. THE WebSphere_System SHALL include time, activity, module, severity, and description for each log entry.

### Requirement 75: Configure and maintain the system (US-075)

**User Story:** As an administrator, I want to configure system settings and maintenance controls, so that the platform can be operated and maintained.

#### Acceptance Criteria

1. WHEN an Administrator updates notification rules, inactivity limits, system updates, or maintenance settings, THE WebSphere_System SHALL persist the configuration.
2. WHEN an Administrator enables maintenance mode, THE WebSphere_System SHALL apply the maintenance settings to the platform.

## Non-Functional Requirements

### Security

1. THE WebSphere_System SHALL enforce role-based access control (RBAC) across all API endpoints for Administrator, Project_Leader, and Project_Member roles.
2. THE WebSphere_System SHALL authenticate API requests using JWT access tokens and issue refresh tokens for session continuity.
3. THE WebSphere_System SHALL store all external OAuth2 tokens in encrypted form at rest.
4. WHEN a user or Administrator logs out, THE WebSphere_System SHALL invalidate the session and associated cached session data.
5. THE WebSphere_System SHALL expose APIs over secure transport (HTTPS) and validate all inputs at the API boundary.
6. THE WebSphere_System SHALL NOT require two-factor authentication, per the US-006 decision.

### Real-Time Performance

7. THE WebSphere_System SHALL deliver chat, task, poll, and presence updates in real time through Socket.IO 4.7+ using a Redis adapter for pub/sub and presence.
8. THE WebSphere_System SHALL process deferrable work (notifications, synchronization, analytics recomputation) through background jobs using BullMQ/Redis.

### Cross-Platform, Responsive, and API-First

9. THE WebSphere_System SHALL expose an API-first REST interface so that an Expo (React Native) client can consume the same backend in a later phase.
10. THE WebSphere_System SHALL present a responsive web interface usable across common desktop and mobile browser screen sizes.
11. THE WebSphere_System SHALL provide WebRTC-based audio and video calling as a later-phase extension (US-016) built on the same real-time architecture.

### AI Accuracy and Academic Guardrails

12. THE WebSphere_System SHALL ground AI recommendations in the current Tools_Catalog and permitted project context using RAG and MCP.
13. THE WebSphere_System SHALL apply moderation and academic-only guardrails to all @helper interactions and SHALL NOT process multimodal inputs.
14. THE WebSphere_System SHALL depend on the OpenAI (ChatGPT) API for AI capabilities, and IF the AI service is unavailable, THEN THE WebSphere_System SHALL degrade gracefully by disabling AI features while core features remain usable.

### Data Accuracy and Consistency

15. THE WebSphere_System SHALL derive progress, KPIs, and predictions from Workflow_Recording and task data rather than manual estimates.
16. THE WebSphere_System SHALL maintain referential integrity between ideas, projects, tasks, groups, and users through MySQL 8 accessed via Prisma ORM.

### Availability and Connectivity

17. THE WebSphere_System SHALL require a stable internet connection for real-time, AI, notification, and integration features, per the proposal's limitations.
18. IF connectivity is lost, THEN THE WebSphere_System SHALL indicate the disconnected state and reconcile data when connectivity is restored.

### Deployment Constraints

19. THE WebSphere_System SHALL be deployed on AWS Lightsail using Docker containers.
20. THE WebSphere_System SHALL use MySQL 8 for persistent storage, Redis for real-time and background-job infrastructure, and AWS SES for email delivery.

## Out of Scope and Limitations

The following are explicitly outside the scope of this build, consistent with the capstone proposal:

1. Integration with institutional systems such as enrollment, registration, or grading is out of scope.
2. Offline operation is out of scope; a stable internet connection is required for real-time, AI, notification, and integration features.
3. Full browser and device compatibility testing is out of scope; the platform is not guaranteed across all browsers and devices.
4. Manual task progress percentage entry (US-031) is deprecated and excluded; progress is derived automatically.
5. Multimodal AI (image, audio, or video understanding) is out of scope for the AI assistant.
6. The Expo (React Native) mobile client and WebRTC audio/video calling are planned later phases; only their enabling architecture is required in this build.
7. The proposal's original "Flutter" cross-platform mention is superseded by the Expo (React Native) decision.
