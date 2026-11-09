# Retain generation context with each draft revision

Date: 2026-11-07
Status: Accepted

A production can generate new wording from an edited brief, a different selection of library or current web sources, and explicit framework or hook choices. Its mutable checkpoint therefore cannot explain every historical draft. Store the generation context with each immutable draft revision rather than resolving historical evidence IDs against the current checkpoint.

Generation preparation preserves the latest saved wording until a replacement revision is saved. It removes approval, scheduling, review pins and earlier revision instructions, and marks the new generation as pending so framework selection leads to writing instead of reviewing the retained draft. Active work, publication locks, terminal productions and unresolved paid attempts cannot be reset. Existing version and lease checks continue to reject stale callbacks.

Selected sources are references to the owner's current server-held evidence or explicitly pinned owned library items. Preserve selected evidence aliases, assign unused aliases to added pins, rebuild author idea and notes from the edited brief, and reassess framework eligibility from the new context. Manual choices are recorded separately from genuine model decisions; author preference cannot waive essential evidence requirements or create model probabilities.

A manual save before research or framework selection has no complete generation context. Keep its snapshot null until an exact-revision review records prepared sources and the selected framework under the existing version and lease checks. Fill a missing snapshot once; a complete snapshot is never replaced by later checkpoint or review changes.

Historical context may be unknown after migration. Archive a missing complete context only for the current latest revision, atomically from its existing production before a brief edit, another saved revision, or generation preparation changes that association. An incomplete checkpoint cannot fill a snapshot, and older unknown contexts remain null. Historical reviews are read-only provenance and cannot approve a current generation or another revision.
