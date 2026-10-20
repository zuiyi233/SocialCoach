#!/bin/bash
# SocialCoach . Love Studio - macOS double-click launcher.
# Runs start.sh (dev server) from Finder. For the built preview version, run
# ./play.sh instead. If macOS refuses to run it, do once: chmod +x start.command
cd "$(dirname "$0")" || exit 1
exec ./start.sh