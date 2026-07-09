CREATE TABLE "program_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ALTER COLUMN "day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "day_id" integer;--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_day_id_program_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."program_days"("id") ON DELETE cascade ON UPDATE no action;