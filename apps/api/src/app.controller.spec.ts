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
