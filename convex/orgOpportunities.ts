import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { getUserId } from "./lib/auth";

const opportunityReturnValidator = v.object({
  _id: v.id("orgOpportunities"),
  _creationTime: v.number(),
  orgId: v.id("organizations"),
  title: v.string(),
  description: v.string(),
  type: v.union(v.literal("course"), v.literal("fellowship"), v.literal("job"), v.literal("other")),
  status: v.union(v.literal("active"), v.literal("closed"), v.literal("draft")),
  deadline: v.optional(v.number()),
  externalUrl: v.optional(v.string()),
  featured: v.boolean(),
  formFields: v.optional(v.any()),
  redirectOpportunityId: v.optional(v.id("orgOpportunities")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

// Get an opportunity by ID
export const get = query({
  args: { id: v.id("orgOpportunities") },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { id }) => {
    const opp = await ctx.db.get("orgOpportunities", id);
    if (!opp) return null;

    // Active opportunities are public
    if (opp.status === "active") return opp;

    // Draft/closed require org admin
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), opp.orgId))
      .first();

    if (!membership || membership.role !== "admin") return null;
    return opp;
  },
});

// Get opportunity with redirect resolution (used by the public apply page)
export const getWithRedirect = query({
  args: { id: v.id("orgOpportunities") },
  returns: v.union(
    v.object({
      kind: v.literal("direct"),
      opportunity: opportunityReturnValidator,
    }),
    v.object({
      kind: v.literal("redirect"),
      originalTitle: v.string(),
      originalDescription: v.string(),
      opportunity: opportunityReturnValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const opp = await ctx.db.get("orgOpportunities", id);
    if (!opp) return null;

    // Active opportunities are served directly
    if (opp.status === "active") {
      return { kind: "direct" as const, opportunity: opp };
    }

    // Closed/draft with redirect — resolve one level
    if (opp.redirectOpportunityId) {
      const target = await ctx.db.get("orgOpportunities", opp.redirectOpportunityId);
      if (target && target.status === "active" && target.orgId === opp.orgId) {
        return {
          kind: "redirect" as const,
          originalTitle: opp.title,
          originalDescription: opp.description,
          opportunity: target,
        };
      }
    }

    // Fall through: admin-only access
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), opp.orgId))
      .first();

    if (!membership || membership.role !== "admin") return null;
    return { kind: "direct" as const, opportunity: opp };
  },
});

// List active opportunities for an org
export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  returns: v.array(opportunityReturnValidator),
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query("orgOpportunities")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .collect();
  },
});

// Get featured opportunity for an org (only active ones)
export const getFeatured = query({
  args: { orgId: v.id("organizations") },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query("orgOpportunities")
      .withIndex("by_org_and_featured_and_status", (q) =>
        q.eq("orgId", orgId).eq("featured", true).eq("status", "active"),
      )
      .first();
  },
});

// Admin: list all opportunities for an org (all statuses)
export const listAllByOrg = query({
  args: { orgId: v.id("organizations") },
  returns: v.array(opportunityReturnValidator),
  handler: async (ctx, { orgId }) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user_and_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
      .first();

    if (!membership || membership.role !== "admin") {
      throw new ConvexError("Admin access required");
    }

    // Single prefix scan over (orgId, status) — one pass instead of three
    // separate .collect() calls, halving the read set and avoiding partial
    // results under concurrent writes.
    const all = await ctx.db
      .query("orgOpportunities")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId))
      .collect();

    // Coerce defaults for fields that may be missing on legacy rows so the
    // return validator (which requires featured/createdAt/updatedAt) can't
    // reject them with an opaque "Server Error" on the client.
    return all.map((opp) => ({
      ...opp,
      featured: opp.featured ?? false,
      createdAt: opp.createdAt ?? opp._creationTime,
      updatedAt: opp.updatedAt ?? opp._creationTime,
    }));
  },
});

// Internal: get opportunity by ID (for use by export action etc.)
export const getInternal = internalQuery({
  args: { id: v.id("orgOpportunities") },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { id }) => {
    return await ctx.db.get("orgOpportunities", id);
  },
});

// Create an opportunity (org admin only)
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    title: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("course"),
      v.literal("fellowship"),
      v.literal("job"),
      v.literal("other"),
    ),
    status: v.union(v.literal("active"), v.literal("closed"), v.literal("draft")),
    deadline: v.optional(v.number()),
    externalUrl: v.optional(v.string()),
    featured: v.boolean(),
    formFields: v.optional(v.any()),
  },
  returns: v.id("orgOpportunities"),
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Verify admin role
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), args.orgId))
      .first();

    if (!membership || membership.role !== "admin") {
      throw new ConvexError("Admin access required");
    }

    const now = Date.now();
    return await ctx.db.insert("orgOpportunities", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update an opportunity (org admin only)
export const update = mutation({
  args: {
    id: v.id("orgOpportunities"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(v.literal("course"), v.literal("fellowship"), v.literal("job"), v.literal("other")),
    ),
    status: v.optional(v.union(v.literal("active"), v.literal("closed"), v.literal("draft"))),
    deadline: v.optional(v.number()),
    externalUrl: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    formFields: v.optional(v.any()),
    redirectOpportunityId: v.optional(v.union(v.id("orgOpportunities"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, redirectOpportunityId, ...updates }) => {
    const userId = await getUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const opportunity = await ctx.db.get("orgOpportunities", id);
    if (!opportunity) throw new ConvexError("Opportunity not found");

    // Verify admin role
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), opportunity.orgId))
      .first();

    if (!membership || membership.role !== "admin") {
      throw new ConvexError("Admin access required");
    }

    const baseUpdate = { ...updates, updatedAt: Date.now() };

    if (redirectOpportunityId === null) {
      await ctx.db.patch("orgOpportunities", id, {
        ...baseUpdate,
        redirectOpportunityId: undefined,
      });
    } else if (redirectOpportunityId !== undefined) {
      if (redirectOpportunityId === id) {
        throw new ConvexError("Cannot redirect an opportunity to itself");
      }
      const target = await ctx.db.get("orgOpportunities", redirectOpportunityId);
      if (!target) throw new ConvexError("Redirect target not found");
      if (target.orgId !== opportunity.orgId) {
        throw new ConvexError("Redirect target must be in the same organization");
      }
      await ctx.db.patch("orgOpportunities", id, {
        ...baseUpdate,
        redirectOpportunityId,
      });
    } else {
      await ctx.db.patch("orgOpportunities", id, baseUpdate);
    }
    return null;
  },
});
