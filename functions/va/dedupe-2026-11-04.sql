-- Voltix Analytics: remove the copies stored before the collector learned to
-- drop them, and fill va_seq from what is stored (4 November 2026).
--
--   npx wrangler d1 execute va --remote --file functions/va/dedupe-2026-11-04.sql
--
-- Safe to run more than once: a second run finds nothing to remove and only
-- raises va_seq's high marks to what is stored. The summaries are rebuilt
-- afterwards by the nightly Worker; run it with VA_BACKFILL_DAYS covering the
-- first stored day so days older than its usual window are rebuilt too.
--
-- A copy is an event whose session and number already appear in an earlier
-- batch of the same install, or earlier in the same batch. The first one
-- stored is the one kept. Events without a session or a number are left alone.

CREATE TABLE IF NOT EXISTS va_seq (
  game    TEXT    NOT NULL,
  install TEXT    NOT NULL,
  session TEXT    NOT NULL,
  hi      INTEGER NOT NULL,
  PRIMARY KEY (game, install, session)
) WITHOUT ROWID;

UPDATE va_batch SET events = (
  SELECT json_group_array(json(e.value) ORDER BY e.key) FROM json_each(va_batch.events) e
  WHERE json_extract(e.value, '$.s') IS NULL OR json_extract(e.value, '$.q') IS NULL
     OR (NOT EXISTS (SELECT 1 FROM va_batch b2, json_each(b2.events) e2
                     WHERE b2.game = va_batch.game AND b2.install = va_batch.install AND b2.id < va_batch.id
                       AND json_extract(e2.value, '$.s') = json_extract(e.value, '$.s')
                       AND json_extract(e2.value, '$.q') = json_extract(e.value, '$.q'))
         AND NOT EXISTS (SELECT 1 FROM json_each(va_batch.events) e3
                         WHERE e3.key < e.key
                           AND json_extract(e3.value, '$.s') = json_extract(e.value, '$.s')
                           AND json_extract(e3.value, '$.q') = json_extract(e.value, '$.q')))
)
WHERE id IN (
  SELECT DISTINCT b.id FROM va_batch b, json_each(b.events) e
  WHERE json_extract(e.value, '$.s') IS NOT NULL AND json_extract(e.value, '$.q') IS NOT NULL
    AND (EXISTS (SELECT 1 FROM va_batch b2, json_each(b2.events) e2
                 WHERE b2.game = b.game AND b2.install = b.install AND b2.id < b.id
                   AND json_extract(e2.value, '$.s') = json_extract(e.value, '$.s')
                   AND json_extract(e2.value, '$.q') = json_extract(e.value, '$.q'))
      OR EXISTS (SELECT 1 FROM json_each(b.events) e3
                 WHERE e3.key < e.key
                   AND json_extract(e3.value, '$.s') = json_extract(e.value, '$.s')
                   AND json_extract(e3.value, '$.q') = json_extract(e.value, '$.q')))
);

UPDATE va_batch SET n = json_array_length(events) WHERE n <> json_array_length(events);

-- A batch that held nothing but copies, and refused nothing, no longer holds anything.
DELETE FROM va_batch WHERE n = 0 AND refused = 0;

INSERT INTO va_seq (game, install, session, hi)
SELECT b.game, b.install, json_extract(e.value, '$.s'), MAX(json_extract(e.value, '$.q'))
FROM va_batch b, json_each(b.events) e
WHERE json_extract(e.value, '$.s') IS NOT NULL AND json_extract(e.value, '$.q') IS NOT NULL
GROUP BY b.game, b.install, json_extract(e.value, '$.s')
ON CONFLICT (game, install, session) DO UPDATE SET hi = MAX(hi, excluded.hi);
