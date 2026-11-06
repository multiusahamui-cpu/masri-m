#!/usr/bin/env bash
# Pemulihan dari cadangan. HATI-HATI: menimpa data produksi. Hentikan API dulu:
#   docker compose -f docker-compose.prod.yml stop api
#   docker compose -f docker-compose.prod.yml run --rm backup restore.sh db /backups/db/masrim-YYYYMMDD-HHMM.dump
#   docker compose -f docker-compose.prod.yml run --rm backup restore.sh files
#   docker compose -f docker-compose.prod.yml start api
set -Eeuo pipefail
DIR=${BACKUP_DIR:-/backups}
confirm() { [ "${FORCE:-}" = "yes" ] && return 0; read -r -p "$1 Ketik YA untuk lanjut: " ok; [ "$ok" = "YA" ] || { echo "Dibatalkan."; exit 1; }; }

case "${1:-}" in
  db)
    f=${2:?berikan path file .dump, mis. /backups/db/masrim-20261010-0200.dump}
    if [ -f "$f.sha256" ]; then (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256"); fi
    confirm "Database $PGDATABASE akan DITIMPA dengan $(basename "$f")."
    psql -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PGDATABASE' and pid <> pg_backend_pid()" > /dev/null
    pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$f"
    echo "Database dipulihkan." ;;
  files)
    confirm "File di bucket ${S3_BUCKET:-masrim} akan disamakan dengan salinan $DIR/files."
    RCLONE_CONFIG_MINIO_TYPE=s3 RCLONE_CONFIG_MINIO_PROVIDER=Minio RCLONE_CONFIG_MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000} \
    RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$MINIO_ROOT_USER" RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
      rclone copy "$DIR/files/" "minio:${S3_BUCKET:-masrim}"
    echo "File dipulihkan." ;;
  *) echo "pemakaian: restore.sh db <file.dump> | restore.sh files"; exit 2 ;;
esac
