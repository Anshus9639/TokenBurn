CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"scope" text DEFAULT 'organization' NOT NULL,
	"project_id" text,
	"feature" text,
	"threshold" numeric(12, 4) NOT NULL,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"webhook_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule_id" text,
	"budget_id" text,
	"type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metric_value" numeric(14, 4),
	"threshold" numeric(14, 4),
	"status" text DEFAULT 'open' NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"last_four" text NOT NULL,
	"hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"requested_by_email" text NOT NULL,
	"decided_by" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_id" text,
	"actor_email" text NOT NULL,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'project' NOT NULL,
	"project_id" text,
	"feature" text,
	"period" text DEFAULT 'monthly' NOT NULL,
	"limit_usd" numeric(12, 2) NOT NULL,
	"hard_limit" boolean DEFAULT false NOT NULL,
	"thresholds" jsonb DEFAULT '[50,75,90,100]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_pricing" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"display_name" text NOT NULL,
	"family" text,
	"category" text DEFAULT 'mid' NOT NULL,
	"input_per_m" numeric(12, 4) NOT NULL,
	"cached_input_per_m" numeric(12, 4) NOT NULL,
	"output_per_m" numeric(12, 4) NOT NULL,
	"cache_write_per_m" numeric(12, 4),
	"context_window" integer NOT NULL,
	"max_output" integer NOT NULL,
	"quality_score" integer DEFAULT 70 NOT NULL,
	"typical_latency_ms" integer DEFAULT 900 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source" text DEFAULT 'internal-catalog' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'scale' NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"credentials_enc" text,
	"key_last4" text,
	"label" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text DEFAULT 'feature' NOT NULL,
	"project_id" text,
	"feature" text,
	"model" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"estimated_monthly_savings_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"measurement" text DEFAULT 'estimated' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text DEFAULT 'weekly' NOT NULL,
	"title" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"feature" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"name" text NOT NULL,
	"strategy" text DEFAULT 'cost_optimized' NOT NULL,
	"primary_model" text NOT NULL,
	"fallback_model" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"max_output_tokens" integer,
	"cache_enabled" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"active_org_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"feature" text DEFAULT 'unnamed' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"pricing_id" text,
	"api_key_id" text,
	"request_id" text,
	"idempotency_key" text,
	"dedupe_hash" text NOT NULL,
	"prompt_hash" text,
	"endpoint" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status_code" integer DEFAULT 200 NOT NULL,
	"cost_usd" numeric(14, 6) NOT NULL,
	"cost_breakdown" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"tags" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"job_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_policies" ADD CONSTRAINT "routing_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_policies" ADD CONSTRAINT "routing_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_pricing_id_model_pricing_id_fk" FOREIGN KEY ("pricing_id") REFERENCES "public"."model_pricing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_org_idx" ON "alert_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "alerts" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_fingerprint_uq" ON "alerts" USING btree ("org_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "approvals_org_status_idx" ON "approval_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_pending_target_uq" ON "approval_requests" USING btree ("org_id","target_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_logs_org_time_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "budgets_org_idx" ON "budgets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_uq" ON "environments" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "features_project_name_uq" ON "features" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_pricing_provider_model_version_uq" ON "model_pricing" USING btree ("provider","model","version");--> statement-breakpoint
CREATE INDEX "model_pricing_lookup_idx" ON "model_pricing" USING btree ("provider","model","effective_from");--> statement-breakpoint
CREATE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_uq" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_org_provider_uq" ON "providers" USING btree ("org_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_org_fingerprint_uq" ON "recommendations" USING btree ("org_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recommendations_org_status_idx" ON "recommendations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "reports_org_idx" ON "reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "routing_policies_org_idx" ON "routing_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_org_dedupe_uq" ON "usage_events" USING btree ("org_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "usage_events_org_time_idx" ON "usage_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_project_time_idx" ON "usage_events" USING btree ("org_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_feature_idx" ON "usage_events" USING btree ("org_id","feature");--> statement-breakpoint
CREATE INDEX "usage_events_prompt_idx" ON "usage_events" USING btree ("org_id","prompt_hash");--> statement-breakpoint
CREATE INDEX "usage_events_model_idx" ON "usage_events" USING btree ("org_id","model");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));