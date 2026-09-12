#!/bin/zsh
set -euo pipefail

# Recovery has not been rehearsed against a separate Supabase project yet.
# Keep this draft disabled until managed schemas, grants and storage recovery
# have been reviewed and a disposable restore has passed.
echo "Restore is not yet validated. Do not use this draft for production recovery."
exit 1

readonly KEYCHAIN_SERVICE="com.rppl.supabase-backup"
readonly OPENSSL_BIN="/opt/homebrew/bin/openssl"

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/restore-supabase-backup.sh <encrypted-backup> <target-database-url>"
  echo "Always restore into a separate test project first."
  exit 1
fi

archive_path="$1"
target_url="$2"
if [[ ! -f "$archive_path" ]]; then
  echo "Backup file not found."
  exit 1
fi

case "$target_url" in
  postgres://*|postgresql://*) ;;
  *)
    echo "Target does not look like a PostgreSQL connection string."
    exit 1
    ;;
esac

backup_key="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w)"
temp_dir="$(mktemp -d /tmp/rppl-supabase-restore.XXXXXX)"
cleanup() {
  chmod -R u+w "$temp_dir" 2>/dev/null || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT INT TERM
chmod 700 "$temp_dir"

"$OPENSSL_BIN" enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass fd:3 3<<<"$backup_key" -in "$archive_path" \
  | tar -xzf - -C "$temp_dir"

echo "This restores into the target database and can overwrite conflicting objects."
read -r "confirmation?Type RESTORE to continue: "
if [[ "$confirmation" != "RESTORE" ]]; then
  echo "Restore cancelled."
  exit 1
fi

/opt/homebrew/opt/libpq/bin/pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$target_url" \
  "$temp_dir/database.dump"

echo "Restore finished. Verify authentication, policies, functions and application flows."
