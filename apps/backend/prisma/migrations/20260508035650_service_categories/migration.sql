-- Step 1: Create service_categories table
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "category" "PatientCategory" NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_serviceId_category_key"
    ON "service_categories"("serviceId", "category");

ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 2: Seed service_categories from existing paymentCategory values
INSERT INTO "service_categories" ("id", "serviceId", "category")
SELECT gen_random_uuid()::text, "id", "paymentCategory"
FROM "services";

-- Step 3: Merge duplicate services (same name → keep max durationMinutes)
DO $$
DECLARE
  grp RECORD;
  winner_id TEXT;
  loser RECORD;
BEGIN
  FOR grp IN
    SELECT name FROM "services" GROUP BY name HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO winner_id
    FROM "services"
    WHERE name = grp.name
    ORDER BY "durationMinutes" DESC, "createdAt" ASC
    LIMIT 1;

    UPDATE "services"
    SET "durationMinutes" = (
      SELECT MAX("durationMinutes") FROM "services" WHERE name = grp.name
    )
    WHERE id = winner_id;

    FOR loser IN
      SELECT id FROM "services"
      WHERE name = grp.name AND id <> winner_id
    LOOP
      INSERT INTO "service_categories" ("id", "serviceId", "category")
      SELECT gen_random_uuid()::text, winner_id, sc.category
      FROM "service_categories" sc
      WHERE sc."serviceId" = loser.id
      ON CONFLICT ("serviceId", "category") DO NOTHING;

      INSERT INTO "doctor_services" ("doctorId", "serviceId")
      SELECT ds."doctorId", winner_id
      FROM "doctor_services" ds
      WHERE ds."serviceId" = loser.id
      ON CONFLICT DO NOTHING;

      DELETE FROM "doctor_services" WHERE "serviceId" = loser.id;

      UPDATE "queue_entries"
      SET "serviceId" = winner_id
      WHERE "serviceId" = loser.id;

      DELETE FROM "service_categories" WHERE "serviceId" = loser.id;
      DELETE FROM "services" WHERE id = loser.id;
    END LOOP;
  END LOOP;
END $$;

-- Step 4: Drop old paymentCategory column
ALTER TABLE "services" DROP COLUMN "paymentCategory";
