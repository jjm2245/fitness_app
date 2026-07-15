ALTER TABLE "set_logs" ADD COLUMN "logged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "set_logs" ADD COLUMN "rest_seconds" integer;--> statement-breakpoint
ALTER TABLE "set_logs" ADD COLUMN "rest_source" text;--> statement-breakpoint
ALTER TABLE "set_logs" ADD COLUMN "drop_set_group" text;