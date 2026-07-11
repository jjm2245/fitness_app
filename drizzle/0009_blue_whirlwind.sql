ALTER TABLE "workout_logs" ADD COLUMN "client_session_id" text;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_client_session_id_unique" UNIQUE("client_session_id");