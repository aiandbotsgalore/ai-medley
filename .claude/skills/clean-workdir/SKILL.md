---
name: clean-workdir
description: Delete all FFmpeg session temp files from workdir/ to free disk space
disable-model-invocation: true
---
Remove all subdirectories in G:/ai-medley--main/workdir/ but keep the workdir/ folder itself.
Run: Remove-Item "G:/ai-medley--main/workdir/*" -Recurse -Force
Report how many session folders were deleted and total MB freed.
