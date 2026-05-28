/** Electron `session.setProxy` 用の設定 ＋ 別途 `app.on('login')` で使う資格情報。 */
export interface ProxyConfig {
  proxyRules: string;
  /** 例: "localhost,127.0.0.1,*.internal" */
  proxyBypassRules?: string;
  /** URL に埋め込まれていた場合の認証（setProxy には渡さず login ハンドラで使う）。 */
  username?: string;
  password?: string;
}

/**
 * 環境変数の値（例: "http://proxy.corp:8080"）を Chromium `proxyRules` が
 * 受け付ける形（"proxy.corp:8080"）に正規化する。
 * - http(s):// は剥がす（URL 形式のまま渡すと ERR_NO_SUPPORTED_PROXIES）
 * - 埋め込み認証・パス・末尾スラッシュは捨てる（認証は extractProxyAuth で別途取得）
 * - socks://, socks4://, socks5:// は Chromium が直接サポートするので維持
 */
function normalizeProxyValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^socks[45]?:\/\//i.test(trimmed)) return trimmed;
  // `new URL` would drop default-port like ":80" for http or ":443" for https
  // (URL spec normalization). Use regex strip instead so the port is preserved verbatim.
  let s = trimmed.replace(/^https?:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');     // drop "user[:pass]@" if present
  s = s.replace(/[/?#].*$/, '');     // drop path/query/fragment
  return s;
}

/**
 * raw が "[scheme://]user[:pass]@host..." の場合に user/pass を取り出す。
 * パーセントエンコーディング（`DOMAIN%5Cuser` 等）はデコードする。
 */
function extractProxyAuth(raw: string): { username?: string; password?: string } {
  const m = raw.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^@/]+)@/i);
  if (!m) return {};
  const auth = m[1];
  const colonIdx = auth.indexOf(':');
  const decode = (s: string): string => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  if (colonIdx === -1) return { username: decode(auth) };
  return {
    username: decode(auth.slice(0, colonIdx)),
    password: decode(auth.slice(colonIdx + 1)),
  };
}

/**
 * 標準的なプロキシ環境変数（HTTPS_PROXY/HTTP_PROXY/NO_PROXY、大文字小文字両方）から
 * Electron 用の設定を組み立てる純関数。何も無ければ null。
 * 取得順は HTTPS_PROXY → https_proxy → HTTP_PROXY → http_proxy（最初に見つかった非空値）。
 * 値は normalizeProxyValue で host:port 形に整える。
 * URL に埋め込み認証があれば username/password を分離して返す（呼び出し側が login ハンドラで使う）。
 */
export function pickProxyFromEnv(env: Record<string, string | undefined>): ProxyConfig | null {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return null;
  const proxyRules = normalizeProxyValue(raw);
  if (!proxyRules) return null;
  const bypass = env.NO_PROXY || env.no_proxy;
  const { username, password } = extractProxyAuth(raw);
  const result: ProxyConfig = { proxyRules };
  if (bypass) result.proxyBypassRules = bypass;
  if (username !== undefined) result.username = username;
  if (password !== undefined) result.password = password;
  return result;
}
