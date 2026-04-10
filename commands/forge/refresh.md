Run the FORGE knowledge refresh — maintain the docs/solutions/ knowledge store.

Invoke the **compound-refresh** agent. It reviews all solution docs against the current codebase:
- Flags stale docs where referenced files have been deleted or renamed
- Identifies duplicate/overlapping solutions
- Archives stale docs to docs/solutions/archive/
- Reports aging docs for manual review

This is a maintenance command — run it periodically to keep the knowledge store accurate.

$ARGUMENTS
