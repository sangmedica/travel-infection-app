// 礼儀正しい HTTP 取得ユーティリティ。
// robots.txt の "Crawl-delay: 20" を尊重し、各リクエスト間に既定20秒の待機を入れる。
// テストや単発取得では SCRAPE_DELAY_MS=0 で無効化できる。

const CONTACT = process.env.SCRAPE_CONTACT || "sangmedica@gmail.com";
const USER_AGENT =
  process.env.SCRAPE_UA ||
  `travel-infection-app/0.1 (+https://github.com/; contact: ${CONTACT})`;
const DELAY_MS = Number.isFinite(Number(process.env.SCRAPE_DELAY_MS))
  ? Number(process.env.SCRAPE_DELAY_MS)
  : 20000;

let lastRequestAt = 0;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSlot() {
  const now = Date.now();
  const wait = lastRequestAt + DELAY_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * URL を GET してテキストを返す。失敗時は指数バックオフで最大3回リトライ。
 * @param {string} url
 * @param {{retries?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<string>}
 */
export async function fetchText(url, opts = {}) {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForSlot();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ac.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const backoff = 3000 * Math.pow(2, attempt);
        console.warn(
          `  ! fetch failed (${err.message}); retry ${attempt + 1}/${retries} in ${backoff}ms`
        );
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

export { USER_AGENT, DELAY_MS };
