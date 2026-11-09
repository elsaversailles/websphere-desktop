import { describe, expect, it } from 'vitest';
import { avatarColor, avatarTone } from './health';
import { groupAvatarUrl } from './GroupAvatar';

describe('fallback avatar colours', () => {
  it('keeps a group colour stable when its name changes', () => {
    const before = decodeURIComponent(groupAvatarUrl('group-123', 'First name'));
    const after = decodeURIComponent(groupAvatarUrl('group-123', 'Renamed group'));
    expect(before).toContain(`fill="${avatarColor('group-123')}"`);
    expect(after).toContain(`fill="${avatarColor('group-123')}"`);
  });
  it('provides a varied, repeatable palette for different IDs', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `user-${index}`);
    expect(new Set(ids.map(avatarTone)).size).toBeGreaterThan(4);
    expect(ids.map(avatarTone)).toEqual(ids.map(avatarTone));
  });
});
