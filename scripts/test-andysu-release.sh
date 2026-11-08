#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
workflow = Path('.github/workflows/release-android.yml').read_text()
name = 'PT3-live-0.0.123-arm64.apk'
plain = 'potato-tomato-0.0.123.apk'
assert 'potato' not in name.lower()
assert 'PT3-live-$VERSION-arm64.apk' in workflow
for assets in ([name, plain], [plain, name]):
    old = next((a for a in assets if 'potato' in a.lower()), assets[0])
    assert old == plain
print('Old clients select the plain APK in either asset order')
PY
pnpm exec vitest run --project server src/lib/utils/app-update.spec.ts
