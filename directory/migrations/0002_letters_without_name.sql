-- The directory stores no player names (docs/friends/BYNAME-ATTEST.md, section 4.2): the recipient's launcher looks
-- the sender's name up at Mojang by the stamped UUID. Apply before deploying the Worker that no longer writes it.
ALTER TABLE letters DROP COLUMN from_name;
