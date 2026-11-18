import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const scope = z.object({ callerId: z.string().cuid(), projectId: z.string().cuid().optional(), groupId: z.string().cuid().optional() });

/** Internal callers must supply identity; omitted Prisma filters must never widen scope. */
export async function readScopedData(prisma: PrismaClient, name: string, input: unknown) {
  if (name === 'getToolsCatalog') return prisma.connectedTool.findMany();
  const args = scope.parse(input);
  const project = { members: { some: { userId: args.callerId } }, OR: [{ groupId: null }, { group: { members: { some: { userId: args.callerId } } } }] };
  switch (name) {
    case 'listProjects': return prisma.project.findMany({ where: { ...project, ...(args.projectId ? { id: args.projectId } : {}) } });
    case 'listTasks': return prisma.task.findMany({ where: { project, ...(args.projectId ? { projectId: args.projectId } : {}) } });
    case 'listIdeas': return prisma.idea.findMany({ where: { group: { members: { some: { userId: args.callerId } } }, ...(args.groupId ? { groupId: args.groupId } : {}) } });
    default: throw new Error('Unknown read-only tool');
  }
}
