#!/usr/bin/env sh
# Restore the executable bit on node-pty's spawn-helper binaries.
#
# Why this exists: bun's tarball extractor (as of 1.3.x) does not always
# preserve POSIX file mode bits when extracting npm tarballs. node-pty ships
# `prebuilds/<platform>/spawn-helper`, a small native binary that the pty
# native addon execs via posix_spawnp() to set up the child process. If the
# helper loses its execute bit, every pty.spawn() call throws
# "posix_spawnp failed." and the renderer never sees a useful error.
#
# Symptoms when this is broken: every pipeline thread fails immediately,
# never produces a plan, and the issue card snaps to "failed" with no
# visible error in the alert/dev console.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Find every spawn-helper inside node_modules (covers all archs + bun cache).
find "$ROOT/node_modules" -type f -name spawn-helper -print0 2>/dev/null \
	| while IFS= read -r -d '' helper; do
		if [ ! -x "$helper" ]; then
			chmod +x "$helper"
			echo "fixed exec bit: $helper"
		fi
	done
