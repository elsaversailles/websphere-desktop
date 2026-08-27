import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
const prisma = new PrismaClient();
const server = new Server({ name: 'websphere-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
const scope = z.object({ callerId: z.string().cuid(), projectId: z.string().cuid().optional(), groupId: z.string().cuid().optional() });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'listProjects', description: 'List only caller-scoped projects.', inputSchema: scope.shape }, { name: 'listTasks', description: 'List only tasks in caller-scoped projects.', inputSchema: scope.shape }, { name: 'listIdeas', description: 'List only caller-scoped group ideas.', inputSchema: scope.shape }, { name: 'getToolsCatalog', description: 'List WebSphere-supported tools.', inputSchema: {} },
] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => { const args = scope.partial().parse(request.params.arguments ?? {}); let data: unknown; switch (request.params.name) { case 'listProjects': data = await prisma.project.findMany({ where: { ...(args.projectId ? { id: args.projectId } : {}), members: { some: { userId: args.callerId } } } }); break; case 'listTasks': data = await prisma.task.findMany({ where: { project: { members: { some: { userId: args.callerId } } }, ...(args.projectId ? { projectId: args.projectId } : {}) } }); break; case 'listIdeas': data = await prisma.idea.findMany({ where: { group: { members: { some: { userId: args.callerId } } }, ...(args.groupId ? { groupId: args.groupId } : {}) } }); break; case 'getToolsCatalog': data = await prisma.connectedTool.findMany(); break; default: throw new Error('Unknown read-only tool'); } return { content: [{ type: 'text', text: JSON.stringify(data) }] }; });
await server.connect(new StdioServerTransport());
