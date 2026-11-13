// Only AWS/MinIO signing fields are ignored. Resource selectors (e.g. versionId)
// remain part of identity. This value is never used as a network URL.
export function photoIdentity(id: string, url: string): string {
  const parsed = new URL(url); // Caller supplies a browserUrl-validated URL.
  const signing = /^(X-Amz-(Algorithm|Credential|Date|Expires|SignedHeaders|Signature|Security-Token))$/i;
  const resourceQuery = Array.from(parsed.searchParams).filter(([name]) => !signing.test(name));
  return JSON.stringify([id, parsed.origin, parsed.pathname, resourceQuery]);
}
