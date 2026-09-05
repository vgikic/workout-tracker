// Sync the data file to a private GitHub repository via the Contents API.
import { mergeData, stableStringify } from './store.js';

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubSync {
  constructor(cfg) {
    this.cfg = cfg; // { token, owner, repo, path, branch }
    this.sha = null;
  }
  get configured() {
    const c = this.cfg;
    return !!(c && c.token && c.owner && c.repo && c.path);
  }
  url() {
    const c = this.cfg;
    return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path}`;
  }
  headers() {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
  async pull() {
    const branch = this.cfg.branch || 'main';
    const res = await fetch(`${this.url()}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) { this.sha = null; return null; }
    if (!res.ok) throw new Error(`GitHub pull failed: ${res.status} ${await safeText(res)}`);
    const json = await res.json();
    this.sha = json.sha;
    if (!json.content) return null;
    try { return JSON.parse(b64decodeUtf8(json.content)); }
    catch (e) { throw new Error('Remote data file is not valid JSON'); }
  }
  async push(data, message) {
    const body = {
      message: message || `Update ${new Date().toISOString()}`,
      content: b64encodeUtf8(stableStringify(data)),
      branch: this.cfg.branch || 'main',
    };
    if (this.sha) body.sha = this.sha;
    const res = await fetch(this.url(), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = new Error(`GitHub push failed: ${res.status} ${await safeText(res)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    this.sha = json.content.sha;
  }
  // Check token, repo access and write permission. Returns { ok, lines: [] } with human-readable findings.
  async diagnose() {
    const lines = []; let ok = true;
    const c = this.cfg;
    try {
      const u = await fetch('https://api.github.com/user', { headers: this.headers(), cache: 'no-store' });
      if (u.status === 401) { lines.push('✗ Token rejected (401 bad credentials). Re-copy the token, it may be truncated or expired.'); return { ok: false, lines }; }
      if (!u.ok) { lines.push(`✗ Token check failed: ${u.status} ${await safeText(u)}`); return { ok: false, lines }; }
      const user = await u.json();
      lines.push(`✓ Token belongs to ${user.login}`);
      if (user.login.toLowerCase() !== c.owner.toLowerCase()) lines.push(`⚠ Owner field is "${c.owner}" but token user is "${user.login}"`);
    } catch (e) { lines.push('✗ Network error reaching api.github.com: ' + e.message); return { ok: false, lines }; }
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}`, { headers: this.headers(), cache: 'no-store' });
    if (r.status === 404) { lines.push(`✗ Repo ${c.owner}/${c.repo} not visible to this token (404). Add it under the token's "Repository access".`); return { ok: false, lines }; }
    if (!r.ok) { lines.push(`✗ Repo check failed: ${r.status} ${await safeText(r)}`); return { ok: false, lines }; }
    const repo = await r.json();
    lines.push(`✓ Repo found (${repo.private ? 'private' : 'PUBLIC'}), default branch ${repo.default_branch}`);
    if ((c.branch || 'main') !== repo.default_branch) lines.push(`⚠ Branch field is "${c.branch}" but the repo's default branch is "${repo.default_branch}"`);
    if (repo.permissions && !repo.permissions.push) { lines.push('✗ Token can read but not write. Set the token\'s Contents permission to "Read and write".'); ok = false; }
    else if (repo.permissions && repo.permissions.push) lines.push('✓ Token has write access');
    const f = await fetch(`${this.url()}?ref=${encodeURIComponent(c.branch || 'main')}`, { headers: this.headers(), cache: 'no-store' });
    if (f.status === 404) lines.push(`ℹ File ${c.path} does not exist yet on ${c.branch || 'main'}; it will be created.`);
    else if (!f.ok) { lines.push(`✗ Reading ${c.path} failed: ${f.status} ${await safeText(f)}`); ok = false; }
    else lines.push(`✓ ${c.path} readable`);
    return { ok, lines };
  }
  // Pull remote, merge with local, push merged result if anything changed. Returns merged data.
  async sync(localData, message) {
    const remote = await this.pull();
    const merged = remote ? mergeData(localData, remote) : localData;
    const mergedStr = stableStringify(merged);
    if (!remote || stableStringify(remote) !== mergedStr) {
      try {
        await this.push(merged, message);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          // someone else wrote in between: pull again, merge, retry once
          const remote2 = await this.pull();
          const merged2 = remote2 ? mergeData(merged, remote2) : merged;
          await this.push(merged2, message);
          return merged2;
        }
        throw e;
      }
    }
    return merged;
  }
}

async function safeText(res) {
  try { const j = await res.json(); return j.message || ''; } catch { return ''; }
}
