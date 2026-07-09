CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
