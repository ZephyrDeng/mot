import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDataDir, resolveConfigPath } from '../config.js';

const SERVICE_NAME = 'mot';
const DATA_DIR = defaultDataDir();

const isLinux = () => process.platform === 'linux';
const isMac = () => process.platform === 'darwin';

export function runDaemon(action: string): void {
  if (isLinux()) return runLinuxDaemon(action);
  if (isMac()) return runMacDaemon(action);
  throw new Error(
    `Daemon management is not supported on ${process.platform}. Supported: linux, darwin.`,
  );
}

// ─── Linux (systemd) ───

const SYSTEMD_USER_DIR = resolve(homedir(), '.config/systemd/user');
const SYSTEMD_SERVICE_PATH = resolve(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);

function runLinuxDaemon(action: string): void {
  switch (action) {
    case 'install':
      linuxInstall();
      return;
    case 'uninstall':
      linuxUninstall();
      return;
    case 'start':
      run('systemctl', ['--user', 'start', SERVICE_NAME]);
      return;
    case 'stop':
      run('systemctl', ['--user', 'stop', SERVICE_NAME]);
      return;
    case 'status':
      run('systemctl', ['--user', 'status', SERVICE_NAME], { allowFailure: true });
      return;
    case 'logs':
      run('journalctl', ['--user', '-u', SERVICE_NAME, '-f', '--no-pager', '-n', '50']);
      return;
    default:
      throw new Error(`Unknown daemon action: ${action}`);
  }
}

function linuxInstall(): void {
  const cliPath = resolveCliPath();
  const nodePath = process.execPath;
  const configPath = resolveConfigPath();

  mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  writeFileSync(
    SYSTEMD_SERVICE_PATH,
    [
      '[Unit]',
      'Description=mot Slack Gateway',
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${homedir()}`,
      `ExecStart=${nodePath} ${cliPath} start`,
      'Restart=on-failure',
      'RestartSec=10',
      'StandardOutput=journal',
      'StandardError=journal',
      `Environment=MOT_CONFIG=${configPath}`,
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n'),
  );

  console.log(`Installed service file: ${SYSTEMD_SERVICE_PATH}`);
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', SERVICE_NAME]);
}

function linuxUninstall(): void {
  run('systemctl', ['--user', 'stop', SERVICE_NAME], { allowFailure: true });
  run('systemctl', ['--user', 'disable', SERVICE_NAME], { allowFailure: true });
  rmSync(SYSTEMD_SERVICE_PATH, { force: true });
  console.log(`Removed service file: ${SYSTEMD_SERVICE_PATH}`);
  run('systemctl', ['--user', 'daemon-reload']);
}

// ─── macOS (launchd) ───

const LAUNCH_AGENTS_DIR = resolve(homedir(), 'Library/LaunchAgents');
const PLIST_PATH = resolve(LAUNCH_AGENTS_DIR, `com.${SERVICE_NAME}.plist`);
const PLIST_LABEL = `com.${SERVICE_NAME}`;
const STDOUT_LOG = resolve(DATA_DIR, 'daemon.stdout.log');
const STDERR_LOG = resolve(DATA_DIR, 'daemon.stderr.log');

function runMacDaemon(action: string): void {
  switch (action) {
    case 'install':
      macInstall();
      return;
    case 'uninstall':
      macUninstall();
      return;
    case 'start':
      macStart();
      return;
    case 'stop':
      macStop();
      return;
    case 'status':
      macStatus();
      return;
    case 'logs':
      run('tail', ['-n', '50', '-f', STDOUT_LOG]);
      return;
    default:
      throw new Error(`Unknown daemon action: ${action}`);
  }
}

function macInstall(): void {
  const cliPath = resolveCliPath();
  const nodePath = process.execPath;
  const configPath = resolveConfigPath();

  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  writeFileSync(
    PLIST_PATH,
    buildPlist({
      nodePath,
      cliPath,
      configPath,
      workingDirectory: homedir(),
      stdoutPath: STDOUT_LOG,
      stderrPath: STDERR_LOG,
      pathEnv: process.env.PATH ?? '',
    }),
  );

  console.log(`Installed plist: ${PLIST_PATH}`);
  run('launchctl', ['bootstrap', `gui/${macUid()}`, PLIST_PATH]);
}

function macUninstall(): void {
  const target = `gui/${macUid()}/${PLIST_LABEL}`;
  run('launchctl', ['bootout', target], { allowFailure: true });
  rmSync(PLIST_PATH, { force: true });
  console.log(`Removed plist: ${PLIST_PATH}`);
}

function macStart(): void {
  run('launchctl', ['kickstart', `gui/${macUid()}/${PLIST_LABEL}`]);
}

export interface MacServiceInfo {
  state: string;
  pid?: string;
}

/** Parse `launchctl print` output; the pid field disappears once the process is gone. */
export function parseLaunchctlPrint(output: string): MacServiceInfo {
  return {
    // States can be multi-word ("not running"), so capture to end of line.
    state: output.match(/state\s*=\s*(.+)/)?.[1].trim() ?? 'unknown',
    pid: output.match(/pid\s*=\s*(\d+)/)?.[1],
  };
}

function isServiceRunning(info: MacServiceInfo | null): boolean {
  return info !== null && info.pid !== undefined && info.state === 'running';
}

// Grace window for the gateway to drain in-flight work and exit after SIGTERM.
const MAC_STOP_TIMEOUT_MS = 10_000;
const MAC_STOP_POLL_MS = 250;

function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Poll `probe` until the service no longer reports a live process — unloaded,
 * no pid, or a state other than "running". Returns false if it is still alive
 * when `timeoutMs` elapses. `now`/`sleep` are injectable for tests.
 */
export function waitForServiceExit(
  probe: () => MacServiceInfo | null,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => void;
  } = {},
): boolean {
  const {
    timeoutMs = MAC_STOP_TIMEOUT_MS,
    pollMs = MAC_STOP_POLL_MS,
    now = Date.now,
    sleep = blockingSleep,
  } = options;
  const deadline = now() + timeoutMs;

  while (isServiceRunning(probe())) {
    if (now() >= deadline) return false;
    sleep(pollMs);
  }

  return true;
}

/**
 * SIGTERM, then block until the process is gone: launchctl kill returns
 * immediately, and a `start` (kickstart) issued while the old process is
 * still draining is a silent no-op that leaves the service stopped.
 */
function macStop(): void {
  if (!isServiceRunning(macServiceInfo())) return;
  run('launchctl', ['kill', 'SIGTERM', `gui/${macUid()}/${PLIST_LABEL}`]);

  if (!waitForServiceExit(macServiceInfo)) {
    throw new Error(
      `Service "${PLIST_LABEL}" is still running ${MAC_STOP_TIMEOUT_MS / 1000}s after SIGTERM.`,
    );
  }
}

function macServiceInfo(): MacServiceInfo | null {
  const result = spawnSync('launchctl', ['print', `gui/${macUid()}/${PLIST_LABEL}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return null;
  return parseLaunchctlPrint(result.stdout);
}

function macStatus(): void {
  const info = macServiceInfo();
  if (!info) {
    console.log(`Service "${PLIST_LABEL}" is not loaded.`);
    return;
  }

  const { state, pid } = info;
  console.log(`Service "${PLIST_LABEL}" is loaded.`);
  console.log(`  state: ${state}`);
  if (pid) console.log(`  pid:   ${pid}`);
}

function buildPlist(options: {
  nodePath: string;
  cliPath: string;
  configPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  pathEnv: string;
}): string {
  const { nodePath, cliPath, configPath, workingDirectory, stdoutPath, stderrPath, pathEnv } =
    options;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${PLIST_LABEL}</string>`,
    '',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${esc(nodePath)}</string>`,
    `    <string>${esc(cliPath)}</string>`,
    '    <string>start</string>',
    '  </array>',
    '',
    '  <key>WorkingDirectory</key>',
    `  <string>${esc(workingDirectory)}</string>`,
    '',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>MOT_CONFIG</key>',
    `    <string>${esc(configPath)}</string>`,
    '    <key>PATH</key>',
    `    <string>${esc(pathEnv)}</string>`,
    '    <key>HOME</key>',
    `    <string>${esc(homedir())}</string>`,
    '  </dict>',
    '',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '',
    '  <key>ThrottleInterval</key>',
    '  <integer>10</integer>',
    '',
    '  <key>StandardOutPath</key>',
    `  <string>${esc(stdoutPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${esc(stderrPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function macUid(): string {
  return spawnSync('id', ['-u'], { encoding: 'utf8' }).stdout.trim();
}

// ─── Shared ───

function resolveCliPath(): string {
  const candidates = [
    fileURLToPath(new URL('./index.js', import.meta.url)),
    fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to resolve cli/index.js path for service installation.');
}

function run(command: string, args: string[], options: { allowFailure?: boolean } = {}): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}
