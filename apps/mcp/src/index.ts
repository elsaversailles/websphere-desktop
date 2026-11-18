import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { readScopedData } from './scoped-data.js';
const prisma = new PrismaClient();
const server = new Server({ name: 'websphere-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
const scope = z.object({ callerId: z.string().cuid(), projectId: z.string().cuid().optional(), groupId: z.string().cuid().optional() });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'listProjects', description: 'List only caller-scoped projects.', inputSchema: scope.shape }, { name: 'listTasks', description: 'List only tasks in caller-scoped projects.', inputSchema: scope.shape }, { name: 'listIdeas', description: 'List only caller-scoped group ideas.', inputSchema: scope.shape }, { name: 'getToolsCatalog', description: 'List WebSphere-supported tools.', inputSchema: {} },
] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: 'text', text: JSON.stringify(await readScopedData(prisma, request.params.name, request.params.arguments ?? {})) }] }));
await server.connect(new StdioServerTransport());
