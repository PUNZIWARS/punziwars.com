# Build Reproducibility

This document describes how to verify that the contents of this repository match the canonical PUNZI Wars countdown pin.

## countdown/ verification

The `countdown/` directory is a byte-for-byte mirror of the canonical countdown pin.

### Verifiable artifacts in this repo

- `countdown/.freeze-hash` — SHA-256 of the canonical content (the "freeze hash")
- `countdown/.bake-config-hash` — SHA-256 of the build-time configuration that produced this pin
- `countdown/.finalize.json` — finalization metadata (pin name, ISO timestamp, the two hashes above)

### Cross-checks a third party can perform

The canonical countdown pin is currently served at IPFS CID:

```
bafybeiekdv7x65luxeyzndgse3kkpljw2d7clwn3h5pclqahzjtn6hwmqa
```

Fetch the freeze-hash from the IPFS pin via any public gateway:

```
curl https://bafybeiekdv7x65luxeyzndgse3kkpljw2d7clwn3h5pclqahzjtn6hwmqa.ipfs.dweb.link/.freeze-hash
```

Compare against the same file in this repository:

```
cat countdown/.freeze-hash
```

Identical values confirm that this mirror serves the same content as the IPFS pin.

Two independent builds from identical source inputs must produce identical hashes.
