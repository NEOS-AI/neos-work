# Helm chart snippet — NEOS Work (v0.6 M5)

Optional **single-replica** chart for the engine container. Not multi-tenant HA.

## Install

```bash
# Build / load image into the cluster first (tag matches values.yaml)
docker build -f deploy/Dockerfile -t neos-work:0.7.0 .

helm upgrade --install neos ./deploy/helm/neos-work \
  --set authToken="$(openssl rand -hex 32)" \
  --set image.repository=neos-work \
  --set image.tag=0.7.0
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
- Collab presence/locks are in-process only — **one replica**.
- See [deploy/README.md](../README.md) for Docker Compose and [docs/security/v0.5.md](../../docs/security/v0.5.md).
