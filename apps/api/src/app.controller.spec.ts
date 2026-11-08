import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';

describe('ICE server endpoint', () => {
  it('returns relays only after verifying the caller belongs to the group', async () => {
    const app = { caller: vi.fn().mockResolvedValue({ id: 'user-1' }), member: vi.fn().mockResolvedValue({}) };
    const turn = { iceServers: vi.fn().mockReturnValue([{ urls: 'turn:turn.websphere.test:3478' }]) };
    const controller = new AppController(app as any, {} as any, {} as any, {} as any, turn as any);

    await expect(controller.iceServers('Bearer token', 'group-1')).resolves.toEqual({ iceServers: [{ urls: 'turn:turn.websphere.test:3478' }] });
    expect(app.member).toHaveBeenCalledWith('group-1', 'user-1');
    expect(turn.iceServers).toHaveBeenCalledWith('user-1');
  });

  it('does not return relay details to a non-member', async () => {
    const app = { caller: vi.fn().mockResolvedValue({ id: 'user-1' }), member: vi.fn().mockRejectedValue(new ForbiddenException()) };
    const turn = { iceServers: vi.fn() };
    const controller = new AppController(app as any, {} as any, {} as any, {} as any, turn as any);

    await expect(controller.iceServers('Bearer token', 'group-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(turn.iceServers).not.toHaveBeenCalled();
  });
});

describe('profile photo removal', () => {
  it('clears only the authenticated user’s avatar', async () => {
    const caller = { id: 'user-1' };
    const app = { caller: vi.fn().mockResolvedValue(caller), updateMe: vi.fn().mockResolvedValue({ id: caller.id, avatarUrl: null }) };
    const controller = new AppController(app as any, {} as any, {} as any, {} as any, {} as any);
    await expect(controller.removeAvatar('Bearer token')).resolves.toEqual({ id: 'user-1', avatarUrl: null });
    expect(app.updateMe).toHaveBeenCalledWith(caller, { avatarUrl: null });
  });
  it('does not update a profile when authentication fails', async () => {
    const app = { caller: vi.fn().mockRejectedValue(new ForbiddenException()), updateMe: vi.fn() };
    const controller = new AppController(app as any, {} as any, {} as any, {} as any, {} as any);
    await expect(controller.removeAvatar('Bearer invalid')).rejects.toBeInstanceOf(ForbiddenException);
    expect(app.updateMe).not.toHaveBeenCalled();
  });
});
