export type GroupRole = 'Project_Leader' | 'Project_Member';

export type GroupSummary = {
  id: string;
  name: string;
  members: Array<{ role: GroupRole }>;
  _count: { projects: number; ideas: number };
};

export type Idea = { id: string; authorId: string; title: string; body: string; status: 'submitted' | 'refined' | 'selected'; createdAt: string };
export type Poll = {
  pollId: string;
  groupId: string;
  open: boolean;
  viewerOptionId: string | null;
  options: Array<{ optionId: string; ideaId: string; label: string; votes: number; voters: Array<{ userId: string; fullName: string }> }>;
};

export type GroupHub = {
  group: {
    id: string;
    name: string;
    members: Array<{ userId: string; role: GroupRole; user: { id: string; fullName: string; avatarUrl?: string | null } }>;
    joinCodes: Array<{ code: string }>;
    projects: Array<{ id: string; title: string }>;
  };
  ideas: Idea[];
  messages: Array<{ id: string; senderId: string; body: string; createdAt: string }>;
  poll: Poll | null;
};
