#!/usr/bin/env bash
# Deploy / update Masri-M di VPS (dijalankan dari folder repo, mis. /opt/masrim).
#   ./deploy/deploy.sh            -> ambil versi terbaru branch main
#   ./deploy/deploy.sh v1.2.0     -> deploy tag tertentu
# Bila API tidak sehat setelah update, otomatis kembali ke versi sebelumnya.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
REF=${1:-main}
COMPOSE="docker compose -f docker-compose.prod.yml"
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
PREV=$(git rev-parse HEAD)

echo "==> Cadangan database sebelum update"
$COMPOSE run --rm backup backup.sh now || { echo "Cadangan gagal — deploy dibatalkan"; exit 1; }

echo "==> Ambil kode $REF"
git fetch --tags origin
if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then git checkout -q "$REF" && git reset -q --hard "origin/$REF"; else git checkout -q "$REF"; fi
VERSION=$(git describe --tags --always)
sed -i "s/^APP_VERSION=.*/APP_VERSION=$VERSION/" .env

echo "==> Build & jalankan versi $VERSION"
$COMPOSE build api web backup
$COMPOSE up -d --remove-orphans

echo "==> Cek kesehatan"
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/api/health" > /dev/null 2>&1; then echo "Sehat. Versi $VERSION aktif."; docker image prune -f > /dev/null; exit 0; fi
  sleep 5
done

echo "!! API tidak sehat setelah 150 detik — kembali ke $PREV"
$COMPOSE logs --tail 80 api || true
git checkout -q "$PREV"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$(git describe --tags --always)/" .env
$COMPOSE build api web && $COMPOSE up -d
echo "Rollback selesai. Catatan: migrasi database yang sudah berjalan tidak dibatalkan; pulihkan dari cadangan bila perlu (docs/DEPLOY.md)."
exit 1
