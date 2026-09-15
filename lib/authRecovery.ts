export type RecoveryCallback = {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  type: string | null;
  errorMessage: string | null;
};

function decode(value: string | null) {
  if (!value) return null;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function getParams(url: string) {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const query = queryIndex >= 0
    ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
    : '';
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  return [new URLSearchParams(query), new URLSearchParams(hash)];
}

export function parseRecoveryCallback(url: string | null | undefined): RecoveryCallback {
  if (!url) {
    return { accessToken: null, refreshToken: null, code: null, type: null, errorMessage: null };
  }
  const [query, hash] = getParams(url);
  const read = (name: string) => hash.get(name) ?? query.get(name);
  return {
    accessToken: read('access_token'),
    refreshToken: read('refresh_token'),
    code: read('code'),
    type: read('type'),
    errorMessage: decode(read('error_description') ?? read('error')),
  };
}

export function passwordValidationMessage(password: string, confirmation: string) {
  if (!password) return 'Enter a new password.';
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 72) return 'Use no more than 72 characters.';
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}

export function resetRequestErrorMessage(error: { status?: number; message?: string } | null | undefined) {
  if (!error) return null;
  if (error.status === 429) return 'Please wait a little before requesting another email.';
  if (/network|fetch|offline|connection/i.test(String(error.message || ''))) {
    return 'Check your connection and try again.';
  }
  // Other responses stay neutral so the screen never reveals whether an account exists.
  return null;
}
