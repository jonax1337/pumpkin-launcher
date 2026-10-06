-- Drop the legacy sender-name column, not displayName inside signed letter bodies (docs/friends/SPEC.md#directory-api).
-- Apply before deploying the Worker that no longer writes from_name.
ALTER TABLE letters DROP COLUMN from_name;
