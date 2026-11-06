#!/usr/bin/env bash
# Cadangan Masri-M. Pemakaian:
#   backup.sh loop   — jalan terus: cadangan harian jam BACKUP_HOUR (default 02) WIB, uji restore tiap Minggu
#   backup.sh now    — cadangan sekali sekarang
#   backup.sh verify — uji restore cadangan terbaru ke database sementara
# Variabel: PGHOST PGUSER PGPASSWORD PGDATABASE, MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET,
#   BACKUP_KEEP_DAYS (14), BACKUP_KEEP_MONTHS (12), RCLONE_REMOTE (mis. "r2:masrim-backup", opsional)
#   BACKUP_AGE_RECIPIENT (opsional, kunci publik age "age1..."): salinan database off-site dienkripsi;
#   kunci privat disimpan DI LUAR server (lihat docs/DEPLOY.md)
set -Eeuo pipefail
# Cadangan berisi data pribadi (KTP, NIK, penghasilan): hanya root yang boleh membaca
umask 077
DIR=${BACKUP_DIR:-/backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
KEEP_MONTHS=${BACKUP_KEEP_MONTHS:-12}
log() { echo "{\"t\":\"$(date -Iseconds)\",\"scope\":\"backup\",\"msg\":\"$*\"}"; }
mkdir -p "$DIR/db" "$DIR/files" "$DIR/monthly" "$DIR/offsite"
chmod 700 "$DIR/db" "$DIR/files" "$DIR/monthly" "$DIR/offsite"
chmod 711 "$DIR"   # API hanya perlu melihat waktu file last-success, tidak bisa membaca isi cadangan"

backup_now() {
  local stamp f
  rm -f "$DIR"/db/*.tmp
  stamp=$(date +%Y%m%d-%H%M)
  f="$DIR/db/masrim-$stamp.dump"
  log "mulai pg_dump $PGDATABASE"
  pg_dump -Fc -Z 6 -f "$f.tmp" "$PGDATABASE"
  pg_restore -l "$f.tmp" > /dev/null          # pastikan arsip terbaca
  mv "$f.tmp" "$f"
  (cd "$DIR/db" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
  log "database selesai: $(basename "$f") $(du -h "$f" | cut -f1)"

  if [ -n "${MINIO_ROOT_USER:-}" ]; then
    RCLONE_CONFIG_MINIO_TYPE=s3 RCLONE_CONFIG_MINIO_PROVIDER=Minio RCLONE_CONFIG_MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000} \
    RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="$MINIO_ROOT_USER" RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
      rclone sync "minio:${S3_BUCKET:-masrim}" "$DIR/files/" --quiet
    log "file MinIO tersalin: $(du -sh "$DIR/files" | cut -f1)"
  fi

  # Cadangan bulanan (tanggal 1) disimpan lebih lama
  if [ "$(date +%d)" = "01" ]; then cp "$f" "$DIR/monthly/"; cp "$f.sha256" "$DIR/monthly/"; fi
  find "$DIR/db" -name 'masrim-*.dump*' -mtime +"$KEEP_DAYS" -delete
  find "$DIR/monthly" -name 'masrim-*.dump*' -mtime +$((KEEP_MONTHS * 31)) -delete

  if [ -n "${RCLONE_REMOTE:-}" ]; then
    local remote_name=${RCLONE_REMOTE%%:*}
    if ! rclone config show "$remote_name" 2>/dev/null | grep -q "type = crypt"; then
      log "PERINGATAN: remote $remote_name bukan rclone crypt — file KTP/KYC tersalin TANPA enkripsi. Gunakan remote crypt (docs/DEPLOY.md)"
    fi
    if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
      # Database off-site dienkripsi dengan kunci publik age (server tidak menyimpan kunci privat)
      rm -f "$DIR"/offsite/*.age
      age -r "$BACKUP_AGE_RECIPIENT" -o "$DIR/offsite/$(basename "$f").age" "$f"
      rclone copy "$DIR/offsite" "$RCLONE_REMOTE/db"
    else
      log "PERINGATAN: BACKUP_AGE_RECIPIENT kosong — dump database tersalin off-site tanpa enkripsi"
      rclone copy "$DIR/db" "$RCLONE_REMOTE/db" --max-age 48h
      rclone copy "$DIR/monthly" "$RCLONE_REMOTE/monthly"
    fi
    rclone sync "$DIR/files" "$RCLONE_REMOTE/files"
    log "salinan off-site ke $RCLONE_REMOTE selesai"
  fi
  touch "$DIR/last-success"
  log "cadangan selesai"
}

verify_latest() {
  local f db=masrim_restore_test
  f=$(ls -1t "$DIR"/db/masrim-*.dump 2>/dev/null | head -1)
  [ -n "$f" ] || { log "GAGAL uji restore: belum ada cadangan"; return 1; }
  (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256" > /dev/null)
  log "uji restore $(basename "$f") ke $db"
  psql -q -d postgres -c "drop database if exists $db" -c "create database $db"
  pg_restore --no-owner -d "$db" "$f"
  local n
  n=$(psql -tA -d "$db" -c "select (select count(*) from users) || ' user, ' || (select count(*) from products) || ' produk, ' || (select count(*) from journal_entries) || ' jurnal'")
  psql -q -d postgres -c "drop database $db"
  touch "$DIR/last-restore-test"
  log "uji restore berhasil: $n"
}

case "${1:-loop}" in
  now) backup_now ;;
  verify) verify_latest ;;
  loop)
    HOUR=${BACKUP_HOUR:-02}
    [ -f "$DIR/last-success" ] || "$0" now || log "GAGAL cadangan awal"
    while true; do
      now=$(date +%s); next=$(date -d "$(date +%Y-%m-%d) $HOUR:00" +%s 2>/dev/null || date -d "$HOUR:00" +%s)
      [ "$next" -le "$now" ] && next=$((next + 86400))
      sleep $((next - now))
      "$0" now || log "GAGAL cadangan — API akan mengirim alert bila tidak ada cadangan berhasil > 26 jam"
      if [ "$(date +%u)" = "7" ]; then "$0" verify || log "GAGAL uji restore mingguan"; fi
    done ;;
  *) echo "pemakaian: backup.sh loop|now|verify"; exit 2 ;;
esac
