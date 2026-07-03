/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as admin from "../admin.js";
import type * as adminAgentChat from "../adminAgentChat.js";
import type * as agent_actions from "../agent/actions.js";
import type * as agent_index from "../agent/index.js";
import type * as agent_mutations from "../agent/mutations.js";
import type * as agent_prompts from "../agent/prompts.js";
import type * as agent_queries from "../agent/queries.js";
import type * as agent_threadOps from "../agent/threadOps.js";
import type * as agent_tools from "../agent/tools.js";
import type * as agent_utils from "../agent/utils.js";
import type * as agentActionLog from "../agentActionLog.js";
import type * as aggregation_aisafety from "../aggregation/aisafety.js";
import type * as aggregation_aisafetyEvents from "../aggregation/aisafetyEvents.js";
import type * as aggregation_dedup from "../aggregation/dedup.js";
import type * as aggregation_eightyK from "../aggregation/eightyK.js";
import type * as aggregation_enrichment from "../aggregation/enrichment.js";
import type * as aggregation_enrichmentMutations from "../aggregation/enrichmentMutations.js";
import type * as aggregation_enrichmentPrompts from "../aggregation/enrichmentPrompts.js";
import type * as aggregation_enrichmentValidation from "../aggregation/enrichmentValidation.js";
import type * as aggregation_sync from "../aggregation/sync.js";
import type * as aggregation_syncMutations from "../aggregation/syncMutations.js";
import type * as aggregation_validation from "../aggregation/validation.js";
import type * as attendance_mutations from "../attendance/mutations.js";
import type * as attendance_queries from "../attendance/queries.js";
import type * as attendance_scheduler from "../attendance/scheduler.js";
import type * as autoEmailConfig from "../autoEmailConfig.js";
import type * as availabilityPolls from "../availabilityPolls.js";
import type * as baishImport from "../baishImport.js";
import type * as baishImportMutations from "../baishImportMutations.js";
import type * as careerActions_compute from "../careerActions/compute.js";
import type * as careerActions_mutations from "../careerActions/mutations.js";
import type * as careerActions_prompts from "../careerActions/prompts.js";
import type * as careerActions_queries from "../careerActions/queries.js";
import type * as careerActions_validation from "../careerActions/validation.js";
import type * as consent from "../consent.js";
import type * as course__helpers from "../course/_helpers.js";
import type * as course_facilitatorComments from "../course/facilitatorComments.js";
import type * as course_facilitatorQueries from "../course/facilitatorQueries.js";
import type * as course_prompts from "../course/prompts.js";
import type * as course_proposals from "../course/proposals.js";
import type * as course_responses from "../course/responses.js";
import type * as course_sessionPairing from "../course/sessionPairing.js";
import type * as course_sessionQueries from "../course/sessionQueries.js";
import type * as course_sessionRunner from "../course/sessionRunner.js";
import type * as course_sessionSetup from "../course/sessionSetup.js";
import type * as course_sidebar from "../course/sidebar.js";
import type * as course_sidebarAgent from "../course/sidebarAgent.js";
import type * as course_sidebarQueries from "../course/sidebarQueries.js";
import type * as coworkingSpaces from "../coworkingSpaces.js";
import type * as crm from "../crm.js";
import type * as crons from "../crons.js";
import type * as emails_adminBroadcast from "../emails/adminBroadcast.js";
import type * as emails_adminBroadcastAction from "../emails/adminBroadcastAction.js";
import type * as emails_autoEmail from "../emails/autoEmail.js";
import type * as emails_autoEmailHelpers from "../emails/autoEmailHelpers.js";
import type * as emails_batchActions from "../emails/batchActions.js";
import type * as emails_outbox from "../emails/outbox.js";
import type * as emails_outboxSend from "../emails/outboxSend.js";
import type * as emails_send from "../emails/send.js";
import type * as emails_templateLibrary from "../emails/templateLibrary.js";
import type * as emails_templates from "../emails/templates.js";
import type * as emails_unsubscribe from "../emails/unsubscribe.js";
import type * as emails_unsubscribeVerify from "../emails/unsubscribeVerify.js";
import type * as engagement_compute from "../engagement/compute.js";
import type * as engagement_mutations from "../engagement/mutations.js";
import type * as engagement_prompts from "../engagement/prompts.js";
import type * as engagement_queries from "../engagement/queries.js";
import type * as engagement_validation from "../engagement/validation.js";
import type * as enrichment_conversation from "../enrichment/conversation.js";
import type * as enrichment_extraction from "../enrichment/extraction.js";
import type * as enrichment_queries from "../enrichment/queries.js";
import type * as enrichment_streaming from "../enrichment/streaming.js";
import type * as enrichment_validation from "../enrichment/validation.js";
import type * as events_lumaClient from "../events/lumaClient.js";
import type * as events_mutations from "../events/mutations.js";
import type * as events_queries from "../events/queries.js";
import type * as events_sync from "../events/sync.js";
import type * as extraction_linkedin from "../extraction/linkedin.js";
import type * as extraction_mutations from "../extraction/mutations.js";
import type * as extraction_pdf from "../extraction/pdf.js";
import type * as extraction_prompts from "../extraction/prompts.js";
import type * as extraction_queries from "../extraction/queries.js";
import type * as extraction_skills from "../extraction/skills.js";
import type * as extraction_text from "../extraction/text.js";
import type * as extraction_validation from "../extraction/validation.js";
import type * as facilitatorAgentChat from "../facilitatorAgentChat.js";
import type * as feedback from "../feedback.js";
import type * as feedbackSurveys from "../feedbackSurveys.js";
import type * as guestBookings from "../guestBookings.js";
import type * as guestProfiles from "../guestProfiles.js";
import type * as http from "../http.js";
import type * as lib_applicantContact from "../lib/applicantContact.js";
import type * as lib_applicantEmail from "../lib/applicantEmail.js";
import type * as lib_applicantName from "../lib/applicantName.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_availabilityWeek from "../lib/availabilityWeek.js";
import type * as lib_baishCourseOpportunities from "../lib/baishCourseOpportunities.js";
import type * as lib_bookingValidation from "../lib/bookingValidation.js";
import type * as lib_crmFields from "../lib/crmFields.js";
import type * as lib_debouncer from "../lib/debouncer.js";
import type * as lib_formFields from "../lib/formFields.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_llmUsage from "../lib/llmUsage.js";
import type * as lib_logging from "../lib/logging.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_rateLimiter from "../lib/rateLimiter.js";
import type * as lib_seed from "../lib/seed.js";
import type * as lib_seedPlatformAdmin from "../lib/seedPlatformAdmin.js";
import type * as lib_slug from "../lib/slug.js";
import type * as matches from "../matches.js";
import type * as matching_coarse from "../matching/coarse.js";
import type * as matching_compute from "../matching/compute.js";
import type * as matching_mutations from "../matching/mutations.js";
import type * as matching_prompts from "../matching/prompts.js";
import type * as matching_queries from "../matching/queries.js";
import type * as matching_validation from "../matching/validation.js";
import type * as mcp_data from "../mcp/data.js";
import type * as mcp_jwt from "../mcp/jwt.js";
import type * as mcp_platform from "../mcp/platform.js";
import type * as mcp_server from "../mcp/server.js";
import type * as mcp_tools from "../mcp/tools.js";
import type * as migrations_backfillAvailabilityPolls from "../migrations/backfillAvailabilityPolls.js";
import type * as migrations_backfillBaishFormFields from "../migrations/backfillBaishFormFields.js";
import type * as migrations_backfillProfileEmails from "../migrations/backfillProfileEmails.js";
import type * as migrations_fixBackfilledPollDefaults from "../migrations/fixBackfilledPollDefaults.js";
import type * as migrations_migrateAutoEmailTemplates from "../migrations/migrateAutoEmailTemplates.js";
import type * as migrations_migrateAvailabilityWeekdays from "../migrations/migrateAvailabilityWeekdays.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
import type * as notifications_realtime from "../notifications/realtime.js";
import type * as notifications_scheduler from "../notifications/scheduler.js";
import type * as opportunities from "../opportunities.js";
import type * as opportunityApplications from "../opportunityApplications.js";
import type * as orgApplications from "../orgApplications.js";
import type * as orgOpportunities from "../orgOpportunities.js";
import type * as organizations from "../organizations.js";
import type * as orgs_admin from "../orgs/admin.js";
import type * as orgs_directory from "../orgs/directory.js";
import type * as orgs_discovery from "../orgs/discovery.js";
import type * as orgs_geocode from "../orgs/geocode.js";
import type * as orgs_geocodeHelpers from "../orgs/geocodeHelpers.js";
import type * as orgs_members from "../orgs/members.js";
import type * as orgs_membership from "../orgs/membership.js";
import type * as orgs_queries from "../orgs/queries.js";
import type * as orgs_stats from "../orgs/stats.js";
import type * as platformAdmin_llmCosts from "../platformAdmin/llmCosts.js";
import type * as platformAdmin_users from "../platformAdmin/users.js";
import type * as playground from "../playground.js";
import type * as profiles from "../profiles.js";
import type * as programs from "../programs.js";
import type * as push from "../push.js";
import type * as pushTokens from "../pushTokens.js";
import type * as skills from "../skills.js";
import type * as spaceBookings from "../spaceBookings.js";
import type * as spaceBookings_admin from "../spaceBookings/admin.js";
import type * as upload from "../upload.js";
import type * as userMigration from "../userMigration.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  admin: typeof admin;
  adminAgentChat: typeof adminAgentChat;
  "agent/actions": typeof agent_actions;
  "agent/index": typeof agent_index;
  "agent/mutations": typeof agent_mutations;
  "agent/prompts": typeof agent_prompts;
  "agent/queries": typeof agent_queries;
  "agent/threadOps": typeof agent_threadOps;
  "agent/tools": typeof agent_tools;
  "agent/utils": typeof agent_utils;
  agentActionLog: typeof agentActionLog;
  "aggregation/aisafety": typeof aggregation_aisafety;
  "aggregation/aisafetyEvents": typeof aggregation_aisafetyEvents;
  "aggregation/dedup": typeof aggregation_dedup;
  "aggregation/eightyK": typeof aggregation_eightyK;
  "aggregation/enrichment": typeof aggregation_enrichment;
  "aggregation/enrichmentMutations": typeof aggregation_enrichmentMutations;
  "aggregation/enrichmentPrompts": typeof aggregation_enrichmentPrompts;
  "aggregation/enrichmentValidation": typeof aggregation_enrichmentValidation;
  "aggregation/sync": typeof aggregation_sync;
  "aggregation/syncMutations": typeof aggregation_syncMutations;
  "aggregation/validation": typeof aggregation_validation;
  "attendance/mutations": typeof attendance_mutations;
  "attendance/queries": typeof attendance_queries;
  "attendance/scheduler": typeof attendance_scheduler;
  autoEmailConfig: typeof autoEmailConfig;
  availabilityPolls: typeof availabilityPolls;
  baishImport: typeof baishImport;
  baishImportMutations: typeof baishImportMutations;
  "careerActions/compute": typeof careerActions_compute;
  "careerActions/mutations": typeof careerActions_mutations;
  "careerActions/prompts": typeof careerActions_prompts;
  "careerActions/queries": typeof careerActions_queries;
  "careerActions/validation": typeof careerActions_validation;
  consent: typeof consent;
  "course/_helpers": typeof course__helpers;
  "course/facilitatorComments": typeof course_facilitatorComments;
  "course/facilitatorQueries": typeof course_facilitatorQueries;
  "course/prompts": typeof course_prompts;
  "course/proposals": typeof course_proposals;
  "course/responses": typeof course_responses;
  "course/sessionPairing": typeof course_sessionPairing;
  "course/sessionQueries": typeof course_sessionQueries;
  "course/sessionRunner": typeof course_sessionRunner;
  "course/sessionSetup": typeof course_sessionSetup;
  "course/sidebar": typeof course_sidebar;
  "course/sidebarAgent": typeof course_sidebarAgent;
  "course/sidebarQueries": typeof course_sidebarQueries;
  coworkingSpaces: typeof coworkingSpaces;
  crm: typeof crm;
  crons: typeof crons;
  "emails/adminBroadcast": typeof emails_adminBroadcast;
  "emails/adminBroadcastAction": typeof emails_adminBroadcastAction;
  "emails/autoEmail": typeof emails_autoEmail;
  "emails/autoEmailHelpers": typeof emails_autoEmailHelpers;
  "emails/batchActions": typeof emails_batchActions;
  "emails/outbox": typeof emails_outbox;
  "emails/outboxSend": typeof emails_outboxSend;
  "emails/send": typeof emails_send;
  "emails/templateLibrary": typeof emails_templateLibrary;
  "emails/templates": typeof emails_templates;
  "emails/unsubscribe": typeof emails_unsubscribe;
  "emails/unsubscribeVerify": typeof emails_unsubscribeVerify;
  "engagement/compute": typeof engagement_compute;
  "engagement/mutations": typeof engagement_mutations;
  "engagement/prompts": typeof engagement_prompts;
  "engagement/queries": typeof engagement_queries;
  "engagement/validation": typeof engagement_validation;
  "enrichment/conversation": typeof enrichment_conversation;
  "enrichment/extraction": typeof enrichment_extraction;
  "enrichment/queries": typeof enrichment_queries;
  "enrichment/streaming": typeof enrichment_streaming;
  "enrichment/validation": typeof enrichment_validation;
  "events/lumaClient": typeof events_lumaClient;
  "events/mutations": typeof events_mutations;
  "events/queries": typeof events_queries;
  "events/sync": typeof events_sync;
  "extraction/linkedin": typeof extraction_linkedin;
  "extraction/mutations": typeof extraction_mutations;
  "extraction/pdf": typeof extraction_pdf;
  "extraction/prompts": typeof extraction_prompts;
  "extraction/queries": typeof extraction_queries;
  "extraction/skills": typeof extraction_skills;
  "extraction/text": typeof extraction_text;
  "extraction/validation": typeof extraction_validation;
  facilitatorAgentChat: typeof facilitatorAgentChat;
  feedback: typeof feedback;
  feedbackSurveys: typeof feedbackSurveys;
  guestBookings: typeof guestBookings;
  guestProfiles: typeof guestProfiles;
  http: typeof http;
  "lib/applicantContact": typeof lib_applicantContact;
  "lib/applicantEmail": typeof lib_applicantEmail;
  "lib/applicantName": typeof lib_applicantName;
  "lib/auth": typeof lib_auth;
  "lib/availabilityWeek": typeof lib_availabilityWeek;
  "lib/baishCourseOpportunities": typeof lib_baishCourseOpportunities;
  "lib/bookingValidation": typeof lib_bookingValidation;
  "lib/crmFields": typeof lib_crmFields;
  "lib/debouncer": typeof lib_debouncer;
  "lib/formFields": typeof lib_formFields;
  "lib/limits": typeof lib_limits;
  "lib/llmUsage": typeof lib_llmUsage;
  "lib/logging": typeof lib_logging;
  "lib/models": typeof lib_models;
  "lib/rateLimiter": typeof lib_rateLimiter;
  "lib/seed": typeof lib_seed;
  "lib/seedPlatformAdmin": typeof lib_seedPlatformAdmin;
  "lib/slug": typeof lib_slug;
  matches: typeof matches;
  "matching/coarse": typeof matching_coarse;
  "matching/compute": typeof matching_compute;
  "matching/mutations": typeof matching_mutations;
  "matching/prompts": typeof matching_prompts;
  "matching/queries": typeof matching_queries;
  "matching/validation": typeof matching_validation;
  "mcp/data": typeof mcp_data;
  "mcp/jwt": typeof mcp_jwt;
  "mcp/platform": typeof mcp_platform;
  "mcp/server": typeof mcp_server;
  "mcp/tools": typeof mcp_tools;
  "migrations/backfillAvailabilityPolls": typeof migrations_backfillAvailabilityPolls;
  "migrations/backfillBaishFormFields": typeof migrations_backfillBaishFormFields;
  "migrations/backfillProfileEmails": typeof migrations_backfillProfileEmails;
  "migrations/fixBackfilledPollDefaults": typeof migrations_fixBackfilledPollDefaults;
  "migrations/migrateAutoEmailTemplates": typeof migrations_migrateAutoEmailTemplates;
  "migrations/migrateAvailabilityWeekdays": typeof migrations_migrateAvailabilityWeekdays;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
  "notifications/realtime": typeof notifications_realtime;
  "notifications/scheduler": typeof notifications_scheduler;
  opportunities: typeof opportunities;
  opportunityApplications: typeof opportunityApplications;
  orgApplications: typeof orgApplications;
  orgOpportunities: typeof orgOpportunities;
  organizations: typeof organizations;
  "orgs/admin": typeof orgs_admin;
  "orgs/directory": typeof orgs_directory;
  "orgs/discovery": typeof orgs_discovery;
  "orgs/geocode": typeof orgs_geocode;
  "orgs/geocodeHelpers": typeof orgs_geocodeHelpers;
  "orgs/members": typeof orgs_members;
  "orgs/membership": typeof orgs_membership;
  "orgs/queries": typeof orgs_queries;
  "orgs/stats": typeof orgs_stats;
  "platformAdmin/llmCosts": typeof platformAdmin_llmCosts;
  "platformAdmin/users": typeof platformAdmin_users;
  playground: typeof playground;
  profiles: typeof profiles;
  programs: typeof programs;
  push: typeof push;
  pushTokens: typeof pushTokens;
  skills: typeof skills;
  spaceBookings: typeof spaceBookings;
  "spaceBookings/admin": typeof spaceBookings_admin;
  upload: typeof upload;
  userMigration: typeof userMigration;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  debouncer: import("@ikhrustalev/convex-debouncer/_generated/component.js").ComponentApi<"debouncer">;
};
