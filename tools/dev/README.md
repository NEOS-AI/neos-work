# tools/dev

Lightweight local lifecycle for the NEOS Work engine (Task 13).

```bash
# from monorepo root
node tools/dev/dev.mjs start
node tools/dev/dev.mjs status
node tools/dev/dev.mjs logs -f
node tools/dev/dev.mjs stop
node tools/dev/dev.mjs restart
```

State is stored under `.tools-dev/` (pid, log, meta with port/token).  
`.tools-dev/` is gitignored.

Prefer Docker self-host for production-like runs — see `deploy/README.md`.
