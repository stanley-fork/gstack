import { describe, test, expect, afterEach } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// End-to-end regression tests for the parent-process watchdog in server.ts.
// Proves three invariants that the v0.18.1.0 fix depends on:
//
//   1. BROWSE_PARENT_PID=0 disables the watchdog (opt-in used by CI and pair-agent).
//   2. BROWSE_HEADED=1 disables the watchdog (server-side defense-in-depth).
//   3. Default headless mode still kills the server when its parent dies
//      (the original orphan-prevention must keep working).
//
// Each test spawns the real server.ts, not a mock. Tests 1 and 2 verify the
// code path via stdout log line (fast). Test 3 waits for the watchdog's 15s
// poll cycle to actually fire (slow — ~25s).

const ROOT = path.resolve(import.meta.dir, '..');
const SERVER_SCRIPT = path.join(ROOT, 'src', 'server.ts');

let tmpDir: string;
let serverProc: Subprocess | null = null;
let parentProc: Subprocess | null = null;

afterEach(async () => {
  // Kill any survivors so subsequent tests get a clean slate.
  try { parentProc?.kill('SIGKILL'); } catch {}
  try { serverProc?.kill('SIGKILL'); } catch {}
  // Give processes a moment to exit before tmpDir cleanup.
  await Bun.sleep(100);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  parentProc = null;
  serverProc = null;
});

function spawnServer(env: Record<string, string>, port: number): Subprocess {
  const stateFile = path.join(tmpDir, 'browse-state.json');
  return spawn(['bun', 'run', SERVER_SCRIPT], {
    env: {
      ...process.env,
      BROWSE_STATE_FILE: stateFile,
      BROWSE_PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no signal sent
    return true;
  } catch {
    return false;
  }
}

// Read stdout until we see the expected marker or timeout. Returns the captured
// text. Used to verify the watchdog code path ran as expected at startup.
async function readStdoutUntil(
  proc: Subprocess,
  marker: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const decoder = new TextDecoder();
  let captured = '';
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  try {
    while (Date.now() < deadline) {
      const readPromise = reader.read();
      const timed = Bun.sleep(Math.max(0, deadline - Date.now()));
      const result = await Promise.race([readPromise, timed.then(() => null)]);
      if (!result || result.done) break;
      captured += decoder.decode(result.value);
      if (captured.includes(marker)) return captured;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return captured;
}

describe('parent-process watchdog (v0.18.1.0)', () => {
  test('BROWSE_PARENT_PID=0 disables the watchdog', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-pid0-'));
    serverProc = spawnServer({ BROWSE_PARENT_PID: '0' }, 34901);

    const out = await readStdoutUntil(
      serverProc,
      'Parent-process watchdog disabled (BROWSE_PARENT_PID=0)',
      5000,
    );
    expect(out).toContain('Parent-process watchdog disabled (BROWSE_PARENT_PID=0)');
    // Control: the "parent exited, shutting down" line must NOT appear —
    // that would mean the watchdog ran after we said to skip it.
    expect(out).not.toContain('Parent process');
  }, 15_000);

  test('BROWSE_HEADED=1 disables the watchdog (server-side guard)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-headed-'));
    // Pass a bogus parent PID to prove BROWSE_HEADED takes precedence.
    // If the server-side guard regresses, the watchdog would try to poll
    // this PID and eventually fire on the "dead parent."
    serverProc = spawnServer(
      { BROWSE_HEADED: '1', BROWSE_PARENT_PID: '999999' },
      34902,
    );

    const out = await readStdoutUntil(
      serverProc,
      'Parent-process watchdog disabled (headed mode)',
      5000,
    );
    expect(out).toContain('Parent-process watchdog disabled (headed mode)');
    expect(out).not.toContain('Parent process 999999 exited');
  }, 15_000);

  test('default headless mode: watchdog fires when parent dies', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-default-'));

    // Spawn a real, short-lived "parent" that the watchdog will poll.
    parentProc = spawn(['sleep', '60'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const parentPid = parentProc.pid!;

    // Default headless: no BROWSE_HEADED, real parent PID — watchdog active.
    serverProc = spawnServer({ BROWSE_PARENT_PID: String(parentPid) }, 34903);
    const serverPid = serverProc.pid!;

    // Give the server a moment to start and register the watchdog interval.
    await Bun.sleep(2000);
    expect(isProcessAlive(serverPid)).toBe(true);

    // Kill the parent. The watchdog polls every 15s, so first tick after
    // parent death lands within ~15s, plus shutdown() cleanup time.
    parentProc.kill('SIGKILL');

    // Poll for up to 25s for the server to exit.
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (!isProcessAlive(serverPid)) break;
      await Bun.sleep(500);
    }
    expect(isProcessAlive(serverPid)).toBe(false);
  }, 45_000);
});
