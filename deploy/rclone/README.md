Taruh `rclone.conf` di folder ini (di VPS, jangan di-commit) untuk salinan cadangan off-site.
Contoh Cloudflare R2:

    [r2]
    type = s3
    provider = Cloudflare
    access_key_id = ...
    secret_access_key = ...
    endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com

Lalu isi `RCLONE_REMOTE=r2:masrim-backup` di `.env`.
