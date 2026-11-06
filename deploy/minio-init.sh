#!/bin/sh
# Dijalankan sekali oleh layanan minio-init (docker-compose.prod.yml):
#  1. buat bucket aplikasi (bila belum ada), tidak publik
#  2. bila MINIO_APP_USER diisi: buat akun khusus API yang HANYA boleh baca/tulis bucket tersebut
set -eu
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET" > /dev/null
if [ -n "${MINIO_APP_USER:-}" ]; then
  [ ${#MINIO_APP_PASSWORD} -ge 16 ] || { echo "MINIO_APP_PASSWORD minimal 16 karakter"; exit 1; }
  cat > /tmp/masrim-app.json <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"], "Resource": ["arn:aws:s3:::$S3_BUCKET"] },
  { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::$S3_BUCKET/*"] } ] }
JSON
  mc admin policy create local masrim-app /tmp/masrim-app.json > /dev/null 2>&1 || true
  mc admin user add local "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" > /dev/null
  mc admin policy attach local masrim-app --user "$MINIO_APP_USER" > /dev/null 2>&1 || true
  echo "Akun MinIO aplikasi $MINIO_APP_USER siap (akses hanya bucket $S3_BUCKET)"
fi
echo "Bucket $S3_BUCKET siap"
