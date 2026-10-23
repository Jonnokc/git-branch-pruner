/**
 * Minimal subset of the built-in Git extension API (vscode.git, API version 1).
 * Full definition: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */
import { Uri } from 'vscode';

export interface FetchOptions {
    remote?: string;
    ref?: string;
    all?: boolean;
    prune?: boolean;
    depth?: number;
}

export interface Repository {
    readonly rootUri: Uri;
    fetch(options?: FetchOptions): Promise<void>;
}

export interface Git {
    readonly path: string;
}

export interface API {
    readonly git: Git;
    readonly repositories: Repository[];
    getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
    readonly enabled: boolean;
    getAPI(version: 1): API;
}
