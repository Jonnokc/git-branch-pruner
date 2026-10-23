import { execFile } from 'child_process';

const defaultTimeoutMs = 30 * 1000;

/**
 * Run a git command in a repository and resolve with stdout.
 *
 * GIT_TERMINAL_PROMPT=0 stops git from waiting on a credential prompt that no one
 * can answer (there is no terminal behind the extension host, e.g. in Remote - WSL),
 * and the timeout guarantees a scan can't hang forever.
 */
export function execGit(gitPath: string, repoPath: string, args: string[], timeoutMs = defaultTimeoutMs): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(gitPath, ['-C', repoPath, ...args], {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = stderr.trim() || (error.killed ? `timed out after ${timeoutMs}ms` : error.message);
                reject(new Error(`git ${args[0]} failed: ${detail}`));
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * Reject if the promise hasn't settled within the given time.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
