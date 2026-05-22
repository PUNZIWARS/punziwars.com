# worker/ — Cloudflare Worker for punzi.xyz

Race-fastest IPFS gateway proxy. On every incoming request, fetches the same path from 5 public IPFS gateways in parallel and serves the first 200 response. Bound to `punzi.xyz` (apex) via Cloudflare's Custom Domain feature.

## Files

- `index.js` — Worker logic (~50 lines)
- `wrangler.toml` — Wrangler deployment config
- `README.md` — this file

## Per pin event

Update the `CID` constant at the top of `index.js` to the new canonical CID, then redeploy:

```
wrangler deploy
```

## Deploying from a fresh checkout

```
npm install -g wrangler
wrangler login
cd worker/
wrangler deploy
```

## License

MIT (see `../LICENSE`).
