#!/bin/bash
# ============================================================
# UPDATE SEKALI JALAN — E-Tiket ApotekKU
# Cara pakai (Mac/Linux): buka Terminal di folder ini, ketik: ./update.sh
# Yang dilakukan: sinkron file, commit, push → GitHub Pages &
# Firebase Hosting (via Actions) terupdate otomatis.
# ============================================================
set -e
cd "$(dirname "$0")"
git add -A
git commit -m "update: $(date '+%Y-%m-%d %H:%M')" || { echo "Tidak ada perubahan untuk di-push."; exit 0; }
git push
echo ""
echo "✅ Terkirim! Tunggu ±1 menit lalu buka situs dengan hard-refresh (Cmd+Shift+R / Ctrl+Shift+R)."
