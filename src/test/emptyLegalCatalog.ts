// Transport fixture for suites that exercise other authenticated workflows.
export function withEmptyLegalCatalog(fetcher: typeof fetch): typeof fetch {
  return (input, options) => {
    if (input === '/api/me/legal-status') return Promise.resolve(Response.json({ requirementsSatisfied: true, documents: [] }));
    if (input === '/api/legal/documents/current') return Promise.resolve(Response.json({ documents: [] }));
    return fetcher(input, options);
  };
}
