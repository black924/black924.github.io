#!/bin/sh
# Runs the Firebase CLI with JDK 21+ (required by the emulators) when Homebrew's openjdk@21 exists.
JDK21=/opt/homebrew/opt/openjdk@21/bin
[ -d "$JDK21" ] && PATH="$JDK21:$PATH"
exec firebase "$@"
