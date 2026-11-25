CREATE TABLE "evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"evaluation_id" text NOT NULL,
	"model" text NOT NULL,
	"case_id" text NOT NULL,
	"status" text NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"quality_score" integer,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6),
	"usage_source" text DEFAULT 'provider_reported' NOT NULL,
	"finish_reason" text,
	"output_excerpt" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"feature" text DEFAULT 'unnamed' NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"strategy" text,
	"policy_id" text,
	"rollout_id" text,
	"requested_model" text,
	"baseline_model" text,
	"selected_model" text,
	"provider" text,
	"status" text DEFAULT 'success' NOT NULL,
	"error_code" text,
	"error_message" text,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"fallback_reason" text,
	"attempted_models" jsonb,
	"streamed" boolean DEFAULT false NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"usage_source" text DEFAULT 'provider_reported' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status_code" integer DEFAULT 200 NOT NULL,
	"cost_usd" numeric(14, 6),
	"baseline_cost_usd" numeric(14, 6),
	"realized_savings_usd" numeric(14, 6),
	"pricing_version" integer,
	"quality_score" integer,
	"baseline_quality_score" integer,
	"similarity_score" integer,
	"provider_request_id" text,
	"request_id" text,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"baseline_model" text,
	"candidate_models" jsonb NOT NULL,
	"dataset" jsonb NOT NULL,
	"summary" jsonb,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routing_rollouts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" text DEFAULT 'canary' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"baseline_model" text NOT NULL,
	"candidate_model" text NOT NULL,
	"traffic_percent" integer DEFAULT 10 NOT NULL,
	"thresholds" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome_reason" text,
	"created_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routing_policies" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_policies" ADD COLUMN "candidates" jsonb;--> statement-breakpoint
ALTER TABLE "routing_policies" ADD COLUMN "min_quality_score" integer;--> statement-breakpoint
ALTER TABLE "routing_policies" ADD COLUMN "max_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_id_model_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."model_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_policy_id_routing_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."routing_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_evaluations" ADD CONSTRAINT "model_evaluations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_evaluations" ADD CONSTRAINT "model_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rollouts" ADD CONSTRAINT "routing_rollouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rollouts" ADD CONSTRAINT "routing_rollouts_policy_id_routing_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."routing_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rollouts" ADD CONSTRAINT "routing_rollouts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_results_eval_idx" ON "evaluation_results" USING btree ("evaluation_id","model");--> statement-breakpoint
CREATE INDEX "gateway_requests_org_time_idx" ON "gateway_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_org_project_time_idx" ON "gateway_requests" USING btree ("org_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_org_model_time_idx" ON "gateway_requests" USING btree ("org_id","selected_model","created_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_org_status_time_idx" ON "gateway_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "model_evaluations_org_time_idx" ON "model_evaluations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "routing_rollouts_org_status_idx" ON "routing_rollouts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "routing_rollouts_policy_status_idx" ON "routing_rollouts" USING btree ("policy_id","status");