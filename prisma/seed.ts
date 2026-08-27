import { PrismaClient, ProviderId, Role } from '@prisma/client';
import { hash } from 'argon2';
const prisma = new PrismaClient();
async function main() {
  const passwordHash = await hash(process.env.SEED_PASSWORD ?? 'ChangeMe!2026');
  const admin = await prisma.user.upsert({ where: { email: 'admin@websphere.local' }, update: {}, create: { email: 'admin@websphere.local', fullName: 'WebSphere Administrator', passwordHash, role: Role.Administrator, institution: 'STI College', course: 'Administration' } });
  await prisma.admin.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id } });
  await prisma.user.upsert({ where: { email: 'student@websphere.local' }, update: {}, create: { email: 'student@websphere.local', fullName: 'Demo Student', passwordHash, role: Role.Project_Member, institution: 'STI College', course: 'BSIT' } });
  for (const tool of [
    [ProviderId.google, 'Google Drive & Docs', 'file'], [ProviderId.microsoft, 'Microsoft 365', 'collaboration'], [ProviderId.trello, 'Trello', 'project-management'], [ProviderId.asana, 'Asana', 'project-management'], [ProviderId.canva, 'Canva', 'design'], [ProviderId.figma, 'Figma', 'design'],
  ] as const) await prisma.connectedTool.upsert({ where: { provider: tool[0] }, update: { name: tool[1], category: tool[2] }, create: { provider: tool[0], name: tool[1], category: tool[2] } });
}
main().finally(() => prisma.$disconnect());
