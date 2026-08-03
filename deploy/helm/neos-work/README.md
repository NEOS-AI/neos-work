# Helm chart snippet — NEOS Work (v0.6 M5 · v0.7 tags)

Optional **single-replica** chart for the engine container. Not multi-tenant HA.

## Install

```bash
# Build / load image into the cluster first (tag matches values.yaml)
docker build -f deploy/Dockerfile -t neos-work:0.8.5 .

helm upgrade --install neos ./deploy/helm/neos-work \
  --set authToken="$(openssl rand -hex 32)" \
  --set image.repository=neos-work \
  --set image.tag=0.8.5
```

## Existing secret

```bash
kubectl create secret generic neos-auth --from-literal=token="…"
helm upgrade --install neos ./deploy/helm/neos-work \
  --set existingSecret=neos-auth \
  --set existingSecretKey=token \
  --set authToken=""
```

## Notes

- Prefer an Ingress + TLS in front of the Service; do not expose `NEOS_ALLOW_ANY_HOST` to the public internet.
- Data volume holds SQLite + media (`NEOS_DATA_DIR=/data`).
- Chart default is **one replica** (`replicaCount: 1`). In-process collab is fine for local-first.
- Multi-replica (Redis bus + presence registry): set env such as `NEOS_COLLAB_BUS=redis`,
  `NEOS_COLLAB_REDIS_URL`, `NEOS_COLLAB_PRESENCE=auto` and follow
  **[docs/ops/multi-replica-collab.md](../../../docs/ops/multi-replica-collab.md)**.
  See also [v0.8 migration](../../../docs/migration/v0.8.0.md) and
  [v0.7 migration](../../../docs/migration/v0.7.0.md).
- Release highlights: [docs/releases/v0.8.5.md](../../../docs/releases/v0.8.5.md).
- See [deploy/README.md](../README.md) for Docker Compose and [docs/security/v0.5.md](../../../docs/security/v0.5.md).
