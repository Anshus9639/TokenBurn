CREATE TABLE "routing_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"budget_id" text NOT NULL,
	"estimate_usd" numeric(14, 6) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "usage_source" text DEFAULT 'provider_reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_holds" ADD CONSTRAINT "routing_holds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_holds" ADD CONSTRAINT "routing_holds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_holds" ADD CONSTRAINT "routing_holds_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routing_holds_budget_expiry_idx" ON "routing_holds" USING btree ("budget_id","expires_at");--> statement-breakpoint
CREATE INDEX "routing_holds_org_idx" ON "routing_holds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_events_feature_time_idx" ON "usage_events" USING btree ("org_id","feature","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_provider_model_time_idx" ON "usage_events" USING btree ("org_id","provider","model","occurred_at");