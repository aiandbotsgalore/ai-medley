---
name: clean-workdir
description: Audit FFmpeg session storage without deleting protected workdir data
disable-model-invocation: true
---

`workdir/` is protected user data. Never bulk-delete, clean, reset, migrate, or
regenerate it. This skill is read-only.

When asked to clean `workdir/`:

1. Report that automatic cleanup is disabled to protect candidates, manifests,
   checkpoints, recovery sidecars, finals, and unfinished sessions.
2. Perform only a read-only inventory when the user asks for one.
3. Do not delete anything unless a separate, explicit user-authorized cleanup
   policy identifies exact files and the application proves each file is owned
   by the same session, execution generation, and cancelled operation and is not
   registered in a manifest or recovery sidecar.
4. Never use recursive wildcard deletion against `workdir/`.
