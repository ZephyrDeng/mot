import { describe, expect, it, vi } from 'vitest';
import { parseLaunchctlPrint, waitForServiceExit } from '../src/cli/daemon.js';

const RUNNING_PRINT = `gui/501/com.mot = {
	active count = 1
	path = /Users/test/Library/LaunchAgents/com.mot.plist
	type = LaunchAgent
	state = running

	program = /usr/bin/node
	arguments = {
		/usr/bin/node
		/usr/lib/node_modules/@zephyrdeng/mot/dist/cli/index.js
		start
	}

	pid = 97306
	exit timeout = 5
}
`;

const STOPPED_PRINT = `gui/501/com.mot = {
	active count = 0
	path = /Users/test/Library/LaunchAgents/com.mot.plist
	type = LaunchAgent
	state = not running

	program = /usr/bin/node
}
`;

const RUNNING = { state: 'running', pid: '1234' };
const STOPPED = { state: 'not running' };

describe('parseLaunchctlPrint', () => {
  it('parses state and pid of a running service', () => {
    expect(parseLaunchctlPrint(RUNNING_PRINT)).toEqual({ state: 'running', pid: '97306' });
  });

  it('reports no pid for a stopped service', () => {
    const info = parseLaunchctlPrint(STOPPED_PRINT);
    expect(info.state).toBe('not running');
    expect(info.pid).toBeUndefined();
  });

  it('falls back to "unknown" when state is missing', () => {
    const info = parseLaunchctlPrint('garbage');
    expect(info.state).toBe('unknown');
    expect(info.pid).toBeUndefined();
  });
});

describe('waitForServiceExit', () => {
  it('returns true without sleeping when the service is not loaded', () => {
    const sleep = vi.fn();
    expect(waitForServiceExit(() => null, { sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns true without sleeping when the service is already stopped', () => {
    const sleep = vi.fn();
    expect(waitForServiceExit(() => STOPPED, { sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('treats a pid with a non-running state as exited', () => {
    const sleep = vi.fn();
    const info = { state: 'not running', pid: '1234' };
    expect(waitForServiceExit(() => info, { sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('polls until the pid disappears, then returns true', () => {
    const sleep = vi.fn();
    let polls = 0;
    const exited = waitForServiceExit(() => (++polls >= 3 ? STOPPED : RUNNING), { sleep });
    expect(exited).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('returns false when the service is still running at the deadline', () => {
    let t = 0;
    const exited = waitForServiceExit(() => RUNNING, {
      timeoutMs: 1000,
      pollMs: 250,
      now: () => t,
      sleep: (ms) => {
        t += ms;
      },
    });
    expect(exited).toBe(false);
  });
});
