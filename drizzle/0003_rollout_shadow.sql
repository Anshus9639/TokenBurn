CREATE TABLE "rollout_shadow_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"rollout_id" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6),
	"quality_score" integer,
	"error_code" text,
	"output_excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rollout_shadow_samples" ADD CONSTRAINT "rollout_shadow_samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_shadow_samples" ADD CONSTRAINT "rollout_shadow_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_shadow_samples" ADD CONSTRAINT "rollout_shadow_samples_rollout_id_routing_rollouts_id_fk" FOREIGN KEY ("rollout_id") REFERENCES "public"."routing_rollouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rollout_shadow_samples_rollout_idx" ON "rollout_shadow_samples" USING btree ("rollout_id","created_at");--> statement-breakpoint
CREATE INDEX "rollout_shadow_samples_org_idx" ON "rollout_shadow_samples" USING btree ("org_id","created_at");
