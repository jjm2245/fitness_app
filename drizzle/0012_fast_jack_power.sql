CREATE TABLE "exercise_machines" (
	"exercise_id" text NOT NULL,
	"machine_id" text NOT NULL,
	CONSTRAINT "exercise_machines_exercise_id_machine_id_pk" PRIMARY KEY("exercise_id","machine_id")
);
--> statement-breakpoint
ALTER TABLE "exercise_machines" ADD CONSTRAINT "exercise_machines_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_machines" ADD CONSTRAINT "exercise_machines_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;