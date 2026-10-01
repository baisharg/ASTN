import { usePostHog } from '@posthog/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from 'convex/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import {
  AlertTriangle,
  Bookmark,
  Check,
  Lock,
  RefreshCw,
  Sparkles,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { MatchSortOrder } from '~/lib/matchScoring'
import { OnboardingGuard } from '~/components/auth/onboarding-guard'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { MobileShell } from '~/components/layout/mobile-shell'
import { useIsMobile } from '~/hooks/use-media-query'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Empty } from '~/components/ui/empty'
import { Spinner } from '~/components/ui/spinner'
import { PullToRefresh } from '~/components/ui/pull-to-refresh'
import { MatchCard } from '~/components/matches/MatchCard'
import { AnimatedCard } from '~/components/animation/AnimatedCard'
import { SwipeableCard } from '~/components/gestures/swipeable-card'
import { SavedMatchesGrid } from '~/components/matches/SavedMatchesSection'
import { AppliedMatchesGrid } from '~/components/matches/AppliedMatchesSection'
import { CareerActionsSection } from '~/components/actions/CareerActionsSection'
import { GrowthAreas } from '~/components/matches/GrowthAreas'
import { CollapsibleSection } from '~/components/ui/collapsible-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { SORT_OPTIONS, sortMatches } from '~/lib/matchScoring'
import { cn } from '~/lib/utils'

// If match progress hasn't advanced in 10 minutes, the batch chain likely broke
const STALE_PROGRESS_MS = 10 * 60 * 1000

// Parse rate limit retryAfter (ms) from ConvexError
function parseRateLimitRetryAfter(err: unknown): number | null {
  try {
    // ConvexError exposes .data with the structured payload
    if (
      err != null &&
      typeof err === 'object' &&
      'data' in err &&
      err.data != null &&
      typeof err.data === 'object' &&
      'kind' in err.data &&
      err.data.kind === 'RateLimited' &&
      'retryAfter' in err.data &&
      typeof err.data.retryAfter === 'number'
    ) {
      return err.data.retryAfter
    }
    // Fallback: regex on message for double-wrapped errors
    const msg = err instanceof Error ? err.message : String(err)
    const match = msg.match(/"retryAfter"\s*:\s*([\d.]+)/)
    if (match) return Number(match[1])
  } catch {
    // ignore parse failures
  }
  return null
}

// Aggregate recommendations into growth areas
function aggregateGrowthAreas(
  recommendations: Array<{ type: string; action: string }> | undefined,
) {
  if (!recommendations || !Array.isArray(recommendations)) {
    return []
  }

  const byType: Record<string, Set<string>> = {
    skill: new Set(),
    experience: new Set(),
  }

  for (const rec of recommendations) {
    // Skip "specific" type as those are per-match, not general growth areas
    if (rec.type === 'skill' || rec.type === 'experience') {
      byType[rec.type].add(rec.action)
    }
  }

  const areas: Array<{ theme: string; items: Array<string> }> = []

  if (byType.skill.size > 0) {
    areas.push({
      theme: 'Skills to build',
      items: [...byType.skill].slice(0, 5),
    })
  }
  if (byType.experience.size > 0) {
    areas.push({
      theme: 'Experience to gain',
      items: [...byType.experience].slice(0, 5),
    })
  }

  return areas
}

export const Route = createFileRoute('/matches/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.matches.getMyMatches, {}),
    )
  },
  component: MatchesPage,
})

function MatchesPage() {
  const isMobile = useIsMobile()
  const profile = useQuery(api.profiles.getOrCreateProfile)
  const user = profile ? { name: profile.name || 'User' } : null

  const pageContent = (
    <>
      <AuthLoading>
        <LoadingState />
      </AuthLoading>
      <Unauthenticated>
        <UnauthenticatedRedirect />
      </Unauthenticated>
      <Authenticated>
        <OnboardingGuard>
          <MatchesContent />
        </OnboardingGuard>
      </Authenticated>
    </>
  )

  if (isMobile) {
    return (
      <MobileShell user={user}>
        <GradientBg variant="subtle">{pageContent}</GradientBg>
      </MobileShell>
    )
  }

  return (
    <GradientBg variant="subtle">
      <AuthHeader />
      {pageContent}
    </GradientBg>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-65px)]">
      <Spinner />
    </div>
  )
}

function UnauthenticatedRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    void navigate({ to: '/login' })
  }, [navigate])
  return <LoadingState />
}

function IncompleteProfileState({
  completeness,
  hasExistingMatches,
}: {
  completeness: {
    completedCount: number
    totalCount: number
    missingRequired: Array<string>
    sectionsNeeded: number
  }
  hasExistingMatches: boolean
}) {
  const { completedCount, totalCount, missingRequired, sectionsNeeded } =
    completeness

  return (
    <main className="container mx-auto px-4 py-8">
      <Card className="max-w-lg mx-auto p-8 text-center">
        <div className="size-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <Lock className="size-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-2xl font-display font-semibold text-foreground mb-2">
          Complete Your Profile to Get Matches
        </h1>
        <p className="text-muted-foreground mb-6">
          We need a bit more information to find opportunities tailored to you.
        </p>

        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2.5 mb-3">
          <div
            className="bg-amber-500 h-2.5 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {completedCount} of {totalCount} sections complete
        </p>

        {/* Missing info */}
        <div className="text-sm text-left bg-muted/50 rounded-lg p-4 mb-6 space-y-2">
          {missingRequired.length > 0 && (
            <p className="text-amber-700 dark:text-amber-300 font-medium">
              Fill in your{' '}
              {missingRequired
                .map((s) => (s === 'careerGoals' ? 'Career Goals' : s))
                .join(', ')}{' '}
              to unlock matching
            </p>
          )}
          {sectionsNeeded > 0 && (
            <p className="text-muted-foreground">
              Complete {sectionsNeeded} more section
              {sectionsNeeded !== 1 ? 's' : ''} (minimum 5 of 7)
            </p>
          )}
        </div>

        <Button asChild>
          <Link to="/profile">Complete Profile</Link>
        </Button>

        {hasExistingMatches && (
          <p className="text-xs text-muted-foreground mt-4">
            Your previous matches will refresh once your profile is complete.
          </p>
        )}
      </Card>
    </main>
  )
}

function ComputingState() {
  const progress = useQuery(api.matches.getMatchProgress)

  return (
    <main className="container mx-auto px-4 py-8">
      <Card className="max-w-lg mx-auto p-8 text-center">
        <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="size-8 text-primary animate-pulse" />
        </div>
        <h1 className="text-2xl font-display font-semibold text-foreground mb-2">
          Finding Your Matches
        </h1>
        {progress ? (
          <>
            <p className="text-muted-foreground mb-4">
              Analyzing opportunities against your profile...
            </p>
            <ProgressBar progress={progress} />
          </>
        ) : (
          <>
            <p className="text-muted-foreground mb-4">
              Our AI is analyzing opportunities against your profile...
            </p>
            <Spinner />
          </>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          This runs in the background — you can leave and come back anytime.
        </p>
      </Card>
    </main>
  )
}

function ProgressBar({
  progress,
}: {
  progress: { completedBatches: number; totalBatches: number }
}) {
  return (
    <>
      <div className="w-full bg-muted rounded-full h-2.5 mb-3">
        <div
          className="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${Math.max(5, (progress.completedBatches / progress.totalBatches) * 100)}%`,
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {progress.completedBatches} of {progress.totalBatches} batches complete
      </p>
    </>
  )
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      {children}
    </div>
  )
}

function ComputingBanner({
  progress,
}: {
  progress: { completedBatches: number; totalBatches: number } | null
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <Sparkles className="size-4 shrink-0 text-primary animate-pulse" />
        <p className="flex-1 text-sm font-medium text-foreground">
          Refreshing your matches...
        </p>
        <span className="text-xs text-muted-foreground shrink-0">
          Runs in background
        </span>
      </div>
      {progress ? (
        <ProgressBar progress={progress} />
      ) : (
        <div className="flex items-center gap-2">
          <Spinner className="size-3" />
          <p className="text-xs text-muted-foreground">Starting...</p>
        </div>
      )}
    </div>
  )
}

function MatchesContent() {
  // Data is synchronously available - preloaded by route loader
  const { data: matchesData } = useSuspenseQuery(
    convexQuery(api.matches.getMyMatches, {}),
  )
  const matchProgress = useQuery(api.matches.getMatchProgress)
  const triggerComputation = useAction(api.matches.triggerMatchComputation)
  const markViewed = useAction(api.matches.markMatchesViewed)
  const posthog = usePostHog()
  // Brief local state: true between clicking refresh and matchProgress appearing
  const [isTriggering, setIsTriggering] = useState(false)
  const [computeError, setComputeError] = useState<string | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null) // seconds

  // Countdown timer for rate limit
  useEffect(() => {
    if (retryAfter == null || retryAfter <= 0) return
    const timer = setTimeout(() => {
      setRetryAfter((prev) => (prev != null && prev > 1 ? prev - 1 : null))
    }, 1000)
    return () => clearTimeout(timer)
  }, [retryAfter])

  // Re-evaluate staleness periodically so the banner appears without re-navigation
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (matchProgress == null) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [matchProgress != null])

  // Detect stuck computations — batch chain broke, progress never cleared
  const isProgressStale =
    matchProgress != null && now - matchProgress.startedAt > STALE_PROGRESS_MS
  const isComputing =
    isTriggering || (matchProgress != null && !isProgressStale)

  // Clear isTriggering once backend progress appears
  useEffect(() => {
    if (matchProgress != null) {
      setIsTriggering(false)
    }
  }, [matchProgress])

  // Mark matches as viewed on mount
  useEffect(() => {
    if (
      matchesData &&
      !matchesData.needsProfile &&
      !matchesData.needsComputation
    ) {
      markViewed().catch(console.error)
    }
  }, [matchesData?.needsComputation, matchesData?.needsProfile, markViewed])

  const handleCompute = async () => {
    setIsTriggering(true)
    setComputeError(null)
    setRetryAfter(null)
    posthog.capture('match_computation_triggered', {
      existing_matches: matchesData?.matches
        ? matchesData.matches.great.length +
          matchesData.matches.good.length +
          matchesData.matches.exploring.length
        : 0,
    })
    try {
      await triggerComputation()
    } catch (err) {
      // Parse rate limit errors from ConvexError
      const retryMs = parseRateLimitRetryAfter(err)
      if (retryMs != null) {
        setRetryAfter(Math.ceil(retryMs / 1000))
      } else if (
        err != null &&
        typeof err === 'object' &&
        'data' in err &&
        (err as { data?: { kind?: string } }).data?.kind === 'ProfileIncomplete'
      ) {
        // Profile incomplete — the reactive query will show the gate card
      } else {
        setComputeError(
          err instanceof Error ? err.message : 'Failed to compute matches',
        )
      }
      setIsTriggering(false)
    }
  }

  // Auto-trigger computation if needed (ref prevents runaway re-triggers)
  const hasAutoTriggered = useRef(false)
  useEffect(() => {
    if (
      matchesData?.needsComputation &&
      !isComputing &&
      !hasAutoTriggered.current &&
      retryAfter == null
    ) {
      hasAutoTriggered.current = true
      void handleCompute()
    }
    if (!matchesData?.needsComputation) {
      hasAutoTriggered.current = false
    }
  }, [matchesData?.needsComputation, isComputing, retryAfter])

  // Aggregate growth areas from ALL matches (including dismissed) - React hooks rule
  const growthAreas = useMemo(() => {
    return aggregateGrowthAreas(matchesData?.allRecommendations)
  }, [matchesData?.allRecommendations])

  if (matchesData === null) {
    return <LoadingState />
  }

  // No profile yet
  if (matchesData.needsProfile) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Card className="max-w-lg mx-auto p-8 text-center">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="size-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-semibold text-foreground mb-2">
            Create Your Profile First
          </h1>
          <p className="text-muted-foreground mb-6">
            Complete your profile to get matched with AI safety opportunities
            tailored to your background and goals.
          </p>
          <Button asChild>
            <Link to="/profile">Create Profile</Link>
          </Button>
        </Card>
      </main>
    )
  }

  // Profile incomplete — gate matching
  if (matchesData.needsCompleteness) {
    return (
      <IncompleteProfileState
        completeness={matchesData.completeness}
        hasExistingMatches={matchesData.hasExistingMatches}
      />
    )
  }

  // Rate limited
  if (retryAfter != null) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Card className="max-w-lg mx-auto p-8 text-center">
          <div className="size-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="size-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-2xl font-display font-semibold text-foreground mb-2">
            Too many requests
          </h1>
          <p className="text-muted-foreground mb-6">
            Match computation is limited to avoid overuse. Try again in{' '}
            <span className="font-medium tabular-nums">
              {Math.floor(retryAfter / 60)}:
              {String(retryAfter % 60).padStart(2, '0')}
            </span>
          </p>
          <Button onClick={handleCompute} disabled={retryAfter > 0}>
            Refresh Matches
          </Button>
        </Card>
      </main>
    )
  }

  // Compute error
  if (computeError) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Card className="max-w-lg mx-auto p-8 text-center">
          <h1 className="text-2xl font-display font-semibold text-foreground mb-2">
            Something went wrong
          </h1>
          <p className="text-red-500 mb-6">{computeError}</p>
          <Button onClick={handleCompute}>Try Again</Button>
        </Card>
      </main>
    )
  }

  return (
    <MatchesList
      matchesData={matchesData}
      isComputing={isComputing}
      isProgressStale={isProgressStale}
      matchProgress={matchProgress}
      growthAreas={growthAreas}
      onCompute={handleCompute}
    />
  )
}

type LoadedMatches = Extract<
  NonNullable<FunctionReturnType<typeof api.matches.getMyMatches>>,
  { matches: unknown }
>

// Split out so its hooks always run in the same order: MatchesContent
// returns early for loading, gating and error states.
function MatchesList({
  matchesData,
  isComputing,
  isProgressStale,
  matchProgress,
  growthAreas,
  onCompute: handleCompute,
}: {
  matchesData: LoadedMatches
  isComputing: boolean
  isProgressStale: boolean
  matchProgress:
    | FunctionReturnType<typeof api.matches.getMatchProgress>
    | undefined
  growthAreas: ReturnType<typeof aggregateGrowthAreas>
  onCompute: () => Promise<void>
}) {
  const posthog = usePostHog()
  const isMobile = useIsMobile()
  const dismissMatch = useMutation(api.matches.dismissMatch)
  const saveMatch = useMutation(api.matches.saveMatch)

  const { matches, savedMatches, appliedMatches, computedAt, matchesStaleAt } =
    matchesData

  // Sort order state
  const [sortOrder, setSortOrder] = useState<MatchSortOrder>('combined')

  const sortedMatches = useMemo(() => {
    const all = [...matches.great, ...matches.good, ...matches.exploring]
    // Exclude matches already shown in saved/applied sections
    const excludeIds = new Set([
      ...savedMatches.map((m) => m._id),
      ...(appliedMatches ?? []).map((m) => m._id),
    ])
    const filtered = all.filter((m) => !excludeIds.has(m._id))
    return sortMatches(filtered, sortOrder)
  }, [
    matches.great,
    matches.good,
    matches.exploring,
    savedMatches,
    appliedMatches,
    sortOrder,
  ])

  const PAGE_SIZE = 12

  // Ensure the card the user navigated from is visible for back-navigation view transitions
  const activeMatchId =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('view-transition-match-id')
      : null
  const activeIndex = activeMatchId
    ? sortedMatches.findIndex((m) => m._id === activeMatchId)
    : -1
  const initialCount = activeIndex >= PAGE_SIZE ? activeIndex + 1 : PAGE_SIZE

  const [visibleCount, setVisibleCount] = useState(initialCount)

  // Reset pagination when match list or sort order changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [sortedMatches.length, sortOrder])

  const visibleMatches = sortedMatches.slice(0, visibleCount)
  const remainingCount = sortedMatches.length - visibleCount

  const hasMatches = sortedMatches.length > 0
  const hasSavedMatches = savedMatches.length > 0

  // Saved/Applied inline expansion state (persisted to sessionStorage)
  const [savedExpanded, setSavedExpanded] = useSessionState(
    'saved-matches-expanded',
    false,
  )
  const [appliedExpanded, setAppliedExpanded] = useSessionState(
    'applied-matches-expanded',
    false,
  )

  // First computation with no existing matches: full-page takeover
  if (isComputing && !hasMatches && !hasSavedMatches) {
    return <ComputingState />
  }

  // Relative time label
  const updatedLabel =
    computedAt != null ? formatRelativeTime(computedAt) : null

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Row 1: Title + Refresh */}
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-xl sm:text-2xl font-display font-semibold text-foreground">
            Your Matches
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCompute}
            disabled={isComputing}
            className="shrink-0"
          >
            <RefreshCw
              className={cn('size-4', isComputing && 'animate-spin')}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {/* Row 2: Subtitle */}
        <p className="text-sm text-muted-foreground mb-4">
          {hasMatches
            ? `${sortedMatches.length} opportunities`
            : 'Opportunities matched to your profile'}
          {updatedLabel && ` · ${updatedLabel}`}
        </p>

        {/* Row 3: Toolbar — chips left, sort right */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {savedMatches.length > 0 && (
            <button
              type="button"
              onClick={() => setSavedExpanded((o) => !o)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors',
                savedExpanded
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40',
              )}
            >
              <Bookmark className="size-3.5 fill-current" />
              {savedMatches.length} Saved
            </button>
          )}
          {appliedMatches && appliedMatches.length > 0 && (
            <button
              type="button"
              onClick={() => setAppliedExpanded((o) => !o)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors',
                appliedExpanded
                  ? 'border-violet-500 bg-violet-100 text-violet-800 dark:border-violet-500 dark:bg-violet-900/40 dark:text-violet-300'
                  : 'border-violet-400 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-400 dark:hover:bg-violet-900/40',
              )}
            >
              <Check className="size-3.5" />
              {appliedMatches.length} Applied
            </button>
          )}
          <div className="ml-auto">
            <Select
              value={sortOrder}
              onValueChange={(v) => setSortOrder(v as MatchSortOrder)}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Computing progress banner (inline, with existing matches visible below) */}
        {isComputing && <ComputingBanner progress={matchProgress ?? null} />}

        {/* Stale progress banner — previous refresh got stuck */}
        {isProgressStale && !isComputing && (
          <WarningBanner>
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              Your last match refresh didn&apos;t complete. Click Refresh to try
              again.
            </p>
          </WarningBanner>
        )}

        {/* Staleness banner (hidden while computing) */}
        {!isComputing && !isProgressStale && matchesStaleAt && (
          <WarningBanner>
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              Your profile has changed since these matches were computed.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCompute}
              disabled={isComputing}
              className="shrink-0"
            >
              <RefreshCw className="size-3 mr-1.5" />
              Refresh
            </Button>
          </WarningBanner>
        )}

        <PullToRefresh
          onRefresh={handleCompute}
          enabled={!isComputing}
          className="min-h-[200px]"
        >
          {/* No matches state (only show if no active AND no saved matches) */}
          {!hasMatches && !hasSavedMatches && (
            <Card className="p-8">
              <Empty
                variant="no-matches"
                description="We couldn't find strong matches right now. Try completing more of your profile or check back when new opportunities are posted."
                action={
                  <div className="flex gap-3 justify-center">
                    <Button asChild variant="outline">
                      <Link to="/profile">Improve Profile</Link>
                    </Button>
                    <Button asChild>
                      <Link to="/opportunities">Browse All Opportunities</Link>
                    </Button>
                  </div>
                }
              />
            </Card>
          )}

          {/* Saved matches inline expansion */}
          <div
            className={cn(
              'grid will-change-[grid-template-rows]',
              'transition-[grid-template-rows] duration-200 ease-out',
              savedExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              {savedMatches.length > 0 && (
                <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 mb-6">
                  <SavedMatchesGrid matches={savedMatches} />
                </div>
              )}
            </div>
          </div>

          {/* Applied matches inline expansion */}
          <div
            className={cn(
              'grid will-change-[grid-template-rows]',
              'transition-[grid-template-rows] duration-200 ease-out',
              appliedExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              {appliedMatches && appliedMatches.length > 0 && (
                <div className="rounded-xl bg-violet-50/70 border border-violet-200 p-4 mb-6">
                  <AppliedMatchesGrid matches={appliedMatches} />
                </div>
              )}
            </div>
          </div>

          {/* Match grid (primary content — now immediately visible) */}
          {hasMatches && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
                {visibleMatches.map((match, index) => {
                  if (isMobile) {
                    return (
                      <SwipeableCard
                        key={match._id}
                        onSwipeLeft={() => {
                          void dismissMatch({ matchId: match._id })
                          posthog.capture('match_dismissed', {
                            match_id: match._id,
                            opportunity_title: match.opportunity.title,
                            organization: match.opportunity.organization,
                            tier: match.tier,
                            source: 'swipe',
                          })
                        }}
                        onSwipeRight={() => {
                          void saveMatch({ matchId: match._id })
                          posthog.capture('match_saved', {
                            match_id: match._id,
                            opportunity_title: match.opportunity.title,
                            organization: match.opportunity.organization,
                            tier: match.tier,
                            source: 'swipe',
                          })
                        }}
                      >
                        <AnimatedCard index={index}>
                          <MatchCard
                            match={match}
                            isSaved={match.status === 'saved'}
                          />
                        </AnimatedCard>
                      </SwipeableCard>
                    )
                  }

                  return (
                    <AnimatedCard key={match._id} index={index}>
                      <MatchCard
                        match={match}
                        isSaved={match.status === 'saved'}
                        onSave={() => {
                          void saveMatch({ matchId: match._id })
                          posthog.capture('match_saved', {
                            match_id: match._id,
                            opportunity_title: match.opportunity.title,
                            organization: match.opportunity.organization,
                            tier: match.tier,
                            source: 'button',
                          })
                        }}
                        onDismiss={() => {
                          void dismissMatch({ matchId: match._id })
                          posthog.capture('match_dismissed', {
                            match_id: match._id,
                            opportunity_title: match.opportunity.title,
                            organization: match.opportunity.organization,
                            tier: match.tier,
                            source: 'button',
                          })
                        }}
                      />
                    </AnimatedCard>
                  )
                })}
              </div>

              {remainingCount > 0 && (
                <div className="flex justify-center mb-8">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                  >
                    Show more ({remainingCount} remaining)
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Career actions - collapsible "Your Next Moves" (collapsed by default) */}
          <CollapsibleSection
            icon={Zap}
            title="Your Next Moves"
            subtitle="Personalized career actions based on your matches"
            className="mb-6"
          >
            <CareerActionsSection hideHeader />
          </CollapsibleSection>

          {/* Growth areas - collapsible, keep visible even when all matches dismissed */}
          {growthAreas.length > 0 && (
            <CollapsibleSection
              icon={TrendingUp}
              title="Your Growth Areas"
              subtitle="Focus areas to improve your fit"
              className="mb-6"
            >
              <GrowthAreas areas={growthAreas} hideHeader />
            </CollapsibleSection>
          )}
        </PullToRefresh>
      </div>
    </main>
  )
}

/** Persist a boolean to sessionStorage. */
function useSessionState(
  key: string,
  defaultValue: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return defaultValue
    const stored = sessionStorage.getItem(key)
    return stored !== null ? stored === 'true' : defaultValue
  })

  useEffect(() => {
    sessionStorage.setItem(key, String(state))
  }, [key, state])

  return [state, setState]
}

/** Format a timestamp as a relative time string. */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'Updated just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Updated yesterday'
  return `Updated ${days}d ago`
}
