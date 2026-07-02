#!/usr/bin/env bash
root="${1:-.qa/results}"
id="$(date +%Y%m%d-%H%M%S)"
dir="$root/$id"
mkdir -p "$dir/screenshots" "$dir/logcat" "$dir/flows"
echo "$dir"
