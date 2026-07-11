CREATE TYPE "public"."effort" AS ENUM('more_in_me', 'near_failure', 'to_failure');--> statement-breakpoint
ALTER TABLE "set_logs" ADD COLUMN "effort" "effort";