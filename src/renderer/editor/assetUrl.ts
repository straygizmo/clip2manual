/**
 * 現在のプロジェクトの資産を指す c2m:// URL を組み立てる。
 *
 * projectDir をクエリ(`?p=...`)に含めることで URL をプロジェクトごとに一意にする。
 * メディア URL がプロジェクト間で同一だと、Chromium のメディアキャッシュが先に開いた
 * プロジェクトのレスポンスを使い回し、別プロジェクトを開いても <video>/<audio> が
 * 同じ動画を再生してしまう。クエリでキャッシュキーを分けることでこれを防ぐ。
 * プロトコルハンドラ(assetProtocol.ts)は URL の pathname だけで解決するため、
 * クエリはファイル解決に影響しない。
 */
export function projectAssetUrl(rel: string, projectDir: string): string {
  return `c2m://asset/${rel}?p=${encodeURIComponent(projectDir)}`;
}
