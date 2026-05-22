// Cloudflare Worker — race-fastest IPFS gateway proxy with security headers.
// Bound to punzi.xyz (apex). Update CID + redeploy via `wrangler deploy`.

// IPFS content identifier. Update this constant before every pin event and run
// `wrangler deploy` from this directory; otherwise the apex will keep serving
// the previous CID's content.
const CID = "bafybeialdlixbhvlje4dcgdtunanfmpoz5x3bul6ywaulswggbqjdtycpq";

const GATEWAYS = [
  (c) => `https://${c}.ipfs.dweb.link`,
  (c) => `https://${c}.ipfs.w3s.link`,
  (c) => `https://${c}.ipfs.nftstorage.link`,
  (c) => `https://ipfs.filebase.io/ipfs/${c}`,
  (c) => `https://ipfs.io/ipfs/${c}`,
];

// Per-gateway timeout. Promise.any() races all five in parallel; 12s leaves
// headroom for slow gateways (w3s.link, nftstorage.link) plus network jitter.
const TIMEOUT_MS = 12000;

const CSP_HEADER = [
  "default-src 'self'",
  // `script-src` does not include `'unsafe-inline'`: all event handlers must
  // be attached via addEventListener (no inline `onerror=`/`onclick=` attrs)
  // and any inline `<script>…</script>` blocks must move to external files.
  // `style-src 'unsafe-inline'` is retained because many components ship with
  // inline `style="…"` attributes that would otherwise be blocked.
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // connect-src is hardcoded. When the dApp adds a new chain, or a price
  // aggregator/RPC endpoint changes, this list must be updated in lockstep
  // (otherwise the dApp silently breaks for that endpoint).
  "connect-src 'self' " +
    "https://punzi-vote-collector.punziwars.workers.dev " +
    "https://1rpc.io https://api.avax.network https://arb1.arbitrum.io " +
    "https://arbitrum-one-rpc.publicnode.com https://arbitrum.drpc.org " +
    "https://avalanche-c-chain-rpc.publicnode.com https://avalanche.drpc.org " +
    "https://base-rpc.publicnode.com https://base.drpc.org " +
    "https://berachain-rpc.publicnode.com https://berachain.drpc.org " +
    "https://bsc-dataseed1.binance.org https://bsc-dataseed2.binance.org " +
    "https://bsc-rpc.publicnode.com https://cloudflare-eth.com " +
    "https://cronos-evm-rpc.publicnode.com https://cronos.drpc.org " +
    "https://eth.drpc.org https://eth.llamarpc.com " +
    "https://ethereum-rpc.publicnode.com https://evm-rpc.sei-apis.com " +
    "https://evm.cronos.org https://flare-api.flare.network " +
    "https://flare.rpc.thirdweb.com https://gnosis-rpc.publicnode.com " +
    "https://gnosis.drpc.org https://hub.snapshot.org " +
    "https://hyperevm-rpc.publicnode.com " +
    "https://hyperliquid.drpc.org https://mainnet.base.org " +
    "https://mainnet.era.zksync.io https://mainnet.optimism.io " +
    "https://mantle-rpc.publicnode.com https://mantle.drpc.org " +
    "https://monad-mainnet.g.alchemy.com https://monad.drpc.org " +
    "https://optimism-rpc.publicnode.com https://optimism.drpc.org " +
    "https://polygon-bor-rpc.publicnode.com https://polygon.drpc.org " +
    "https://polygon.llamarpc.com https://public-en.node.kaia.io " +
    "https://rpc.ankr.com https://rpc.berachain.com " +
    "https://rpc.flashbots.net https://rpc.gnosischain.com " +
    "https://rpc.hyperliquid.xyz https://rpc.mantle.xyz " +
    "https://rpc.monad.xyz https://rpc.soniclabs.com " +
    "https://sei.drpc.org https://sonic-rpc.publicnode.com " +
    "https://sonic.drpc.org https://zksync.drpc.org " +
    "https://api.coingecko.com https://api.coinpaprika.com " +
    "https://api.dexscreener.com https://api.coinbase.com " +
    "https://coins.llama.fi https://min-api.cryptocompare.com " +
    "https://*.walletconnect.com https://*.walletconnect.org " +
    "https://*.reown.com " +
    "wss://*.walletconnect.com wss://*.walletconnect.org wss://*.reown.com",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // frame-src is intentionally tight — only the Cloudflare Turnstile widget
  // is allowed to embed. Adding another origin requires a security review.
  "frame-src 'self' https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=()",
  "bluetooth=()",
  "camera=()",
  "cross-origin-isolated=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "keyboard-map=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=(self)",
  "screen-wake-lock=()",
  "serial=()",
  "sync-xhr=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()",
].join(", ");

function withSecurityHeaders(upstream) {
  const headers = new Headers(upstream.headers);
  headers.delete("Content-Security-Policy");
  headers.delete("content-security-policy");
  headers.delete("Content-Security-Policy-Report-Only");
  headers.delete("content-security-policy-report-only");
  headers.set("Content-Security-Policy", CSP_HEADER);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const suffix = url.pathname + url.search;
    const upstreams = GATEWAYS.map((g) => g(CID) + suffix);

    const winner = await Promise.any(
      upstreams.map(async (target) => {
        const res = await fetchWithTimeout(target, TIMEOUT_MS);
        if (!res || res.status !== 200) throw new Error("not 200");
        return res;
      }),
    ).catch(() => null);

    if (!winner) {
      // All five gateways failed. Return a minimal HTML page so visitors see a
      // human-readable message instead of a raw browser-default 503.
      const body =
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
        "<title>PUNZI — Temporarily Unavailable</title>" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<style>html,body{margin:0;background:#0a0a0f;color:#e5e5ee;font-family:system-ui,-apple-system,sans-serif;height:100%}" +
        "main{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;min-height:100vh}" +
        "h1{font-size:1.4rem;margin:0 0 0.5rem;font-weight:600}p{opacity:0.7;font-size:0.95rem;max-width:32rem;line-height:1.5}</style>" +
        "</head><body><main><h1>PUNZI</h1>" +
        "<p>The site is temporarily unreachable through every IPFS gateway. Try again in a moment.</p>" +
        "</main></body></html>";
      return new Response(body, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const headers = new Headers(winner.headers);
    headers.set("x-punzi-upstream", new URL(winner.url).hostname);
    headers.delete("set-cookie");

    return withSecurityHeaders(
      new Response(winner.body, { status: winner.status, headers }),
    );
  },
};

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
