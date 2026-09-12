#!/bin/zsh
set -euo pipefail

readonly PROJECT_REF="jvojjtjklqtmdtmeqqyy"
readonly KEYCHAIN_SERVICE="com.rppl.supabase-backup"
readonly PG_DUMP_BIN="/opt/homebrew/opt/libpq/bin/pg_dump"
readonly OPENSSL_BIN="/opt/homebrew/bin/openssl"
readonly DEFAULT_BACKUP_DIR="/Users/f4f/Library/Mobile Documents/com~apple~CloudDocs/RPPL/Backups/Supabase"
readonly SCRIPT_DIR="${0:A:h}"

if [[ ! -x "$PG_DUMP_BIN" ]]; then
  echo "PostgreSQL backup tools are not installed."
  exit 1
fi

if [[ ! -x "$OPENSSL_BIN" ]]; then
  echo "OpenSSL is not installed."
  exit 1
fi

database_url="${RPPL_SUPABASE_DB_URL:-}"
if [[ -z "$database_url" ]]; then
  echo "Enter the Wavemark database password."
  echo "Your typing will be hidden and the password will not be saved."
  read -r -s "database_password?Database password: "
  echo
  encoded_password="$(printf '%s' "$database_password" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(encodeURIComponent(s)))")"
  unset database_password
  database_url="postgresql://postgres.${PROJECT_REF}:${encoded_password}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"
  unset encoded_password
fi

case "$database_url" in
  postgres://*|postgresql://*) ;;
  *)
    echo "That does not look like a PostgreSQL connection string."
    exit 1
    ;;
esac

backup_dir="${RPPL_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
temp_dir="$(mktemp -d /tmp/rppl-supabase-backup.XXXXXX)"
encrypted_temp="$temp_dir/RPPL-Supabase-$timestamp.rppl-backup.enc"
final_path="$backup_dir/RPPL-Supabase-$timestamp.rppl-backup.enc"

cleanup() {
  chmod -R u+w "$temp_dir" 2>/dev/null || true
  rm -rf "$temp_dir"
}
trap cleanup EXIT INT TERM
chmod 700 "$temp_dir"

echo "Exporting Wavemark database…"
"$PG_DUMP_BIN" \
  --format=custom \
  --no-owner \
  --file="$temp_dir/database.dump" \
  "$database_url"
chmod 600 "$temp_dir/database.dump"

"/opt/homebrew/opt/libpq/bin/pg_restore" --data-only --schema=storage --table=objects \
  --file="$temp_dir/objects.sql" "$temp_dir/database.dump"
node "$SCRIPT_DIR/backup-avatar-files.mjs" "$temp_dir/objects.sql" "$temp_dir/avatars"

{
  echo "RPPL Supabase backup"
  echo "Project: $PROJECT_REF"
  echo "Created UTC: $timestamp"
  echo "Format: PostgreSQL custom archive"
  "$PG_DUMP_BIN" --version
} > "$temp_dir/README.txt"
chmod 600 "$temp_dir/README.txt"

backup_key="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
if [[ -z "$backup_key" ]]; then
  backup_key="$($OPENSSL_BIN rand -base64 48)"
  security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" -w "$backup_key" >/dev/null
  echo "Created an encryption key in your macOS Keychain."
fi

echo "Encrypting backup…"
tar -C "$temp_dir" -czf - database.dump README.txt avatars \
  | "$OPENSSL_BIN" enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass fd:3 3<<<"$backup_key" \
    > "$encrypted_temp"
chmod 600 "$encrypted_temp"

mkdir -p "$backup_dir"
mv "$encrypted_temp" "$final_path"

"$OPENSSL_BIN" enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass fd:3 3<<<"$backup_key" -in "$final_path" \
  | tar -tzf - >/dev/null

size="$(du -h "$final_path" | awk '{print $1}')"
echo "Backup created and verified:"
echo "$final_path"
echo "Encrypted size: $size"
