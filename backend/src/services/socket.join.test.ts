import { describe, it, expect } from 'vitest';
import { canJoin } from './socket.js';

const AGENT = '0xb3a3d85ef6c80e5523266f55a71b51e418b61178';

describe('socket canJoin', () => {
  it('allows public broadcast rooms without auth', () => {
    expect(canJoin('platform', null)).toBe(true);
    expect(canJoin('tasks', null)).toBe(true);
    expect(canJoin('disputes', null)).toBe(true);
  });

  it('allows per-task rooms without auth (numeric id or 0x hash)', () => {
    expect(canJoin('task:49', null)).toBe(true);
    expect(canJoin(`task:0x${'ab'.repeat(32)}`, null)).toBe(true);
    expect(canJoin('task:not-an-id', null)).toBe(false);
  });

  it('denies agent rooms without auth', () => {
    expect(canJoin(`agent:${AGENT}`, null)).toBe(false);
  });

  it('allows an agent room only for the authenticated agent itself', () => {
    expect(canJoin(`agent:${AGENT}`, AGENT)).toBe(true);
    // case-insensitive room, but only the matching address
    expect(canJoin(`agent:${AGENT.toUpperCase().replace('0X', '0x')}`, AGENT)).toBe(true);
    expect(canJoin(`agent:${AGENT}`, '0x000000000000000000000000000000000000dead')).toBe(false);
  });

  it('denies unknown room shapes (including raw socket ids)', () => {
    expect(canJoin('some-socket-id', null)).toBe(false);
    expect(canJoin('admin', AGENT)).toBe(false);
    expect(canJoin('', AGENT)).toBe(false);
  });
});
