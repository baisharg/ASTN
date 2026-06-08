import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  GraduationCap,
  Lock,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { AISidebar } from '~/components/course/AISidebar'
import { AISidebarProvider } from '~/components/course/AISidebarProvider'
import { AISidebarToggle } from '~/components/course/AISidebarToggle'
import { ModulePrompts } from '~/components/course/ModulePrompts'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { MaterialChecklist } from '~/components/programs/MaterialChecklist'
import { RsvpGrid } from '~/components/programs/RsvpGrid'
import { RsvpSelector } from '~/components/programs/RsvpSelector'
import { ParticipantLiveView } from '~/components/session/ParticipantLiveView'
import { programTypeLabels } from '~/lib/program-constants'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'

function daysUntilSession(sessionDate: number): number {
  const sessionDay = new Date(sessionDate)
  sessionDay.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((sessionDay.getTime() - today.getTime()) / 86400000)
}

export const Route = createFileRoute('/org/$slug/program/$programSlug')({
  component: ProgramPage,
})

const EMPTY_SET = new Set<number>()
const EMPTY_RSVPS: Array<{
  userId: string
  userName: string
  preference: 'morning' | 'afternoon' | 'either'
}> = []

function ProgramPage() {
  const { slug, programSlug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const data = useQuery(
    api.programs.getProgramBySlug,
    org ? { orgId: org._id, programSlug } : 'skip',
  )
  // Fetch all RSVPs separately (heavier query)
  const allRsvps = useQuery(
    api.programs.getSessionRsvps,
    data?.program ? { programId: data.program._id } : 'skip',
  )

  // Extract arrays with safe defaults so all hooks run unconditionally
  const modules = data?.modules ?? []
  const sessions = data?.sessions ?? []
  const myRsvps = data?.myRsvps ?? []
  const myAttendance = data?.myAttendance ?? []
  const myMaterialProgress = data?.myMaterialProgress ?? []
  const promptCompletionByModule = data?.promptCompletionByModule ?? []

  // Compute progressMap once and pass to children
  const progressMap = useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const p of myMaterialProgress) {
      if (!map.has(p.moduleId)) map.set(p.moduleId, new Set())
      map.get(p.moduleId)!.add(p.materialIndex)
    }
    return map
  }, [myMaterialProgress])

  // Compute continue-here target: first incomplete essential material or exercise
  const continueHere = useMemo(() => {
    const promptMap = new Map(
      promptCompletionByModule.map((p) => [p.moduleId, p]),
    )
    for (const mod of [...modules].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    )) {
      if (mod.status === 'locked') continue
      const completed = progressMap.get(mod._id)
      // Check essential materials first
      if (mod.materials) {
        for (let i = 0; i < mod.materials.length; i++) {
          if (mod.materials[i].isEssential === false) continue
          if (!completed?.has(i)) {
            return {
              moduleId: mod._id,
              materialIndex: i,
              type: 'material' as const,
            }
          }
        }
      }
      // Then check prompts
      const pc = promptMap.get(mod._id)
      if (pc && pc.completedPrompts < pc.totalPrompts) {
        return {
          moduleId: mod._id,
          materialIndex: null,
          type: 'prompt' as const,
        }
      }
    }
    return null
  }, [modules, progressMap, promptCompletionByModule])

  // Active module for sidebar (default to first available module)
  const [activeModuleId, setActiveModuleId] =
    useState<Id<'programModules'> | null>(null)

  const effectiveModuleId = useMemo(() => {
    if (activeModuleId) return activeModuleId
    const first = modules.find(
      (m) => m.status === 'available' || m.status === 'completed',
    )
    return first?._id ?? null
  }, [activeModuleId, modules])

  // Pre-group allRsvps by sessionId to avoid O(S*R) filtering
  const rsvpsBySession = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        userId: string
        userName: string
        preference: 'morning' | 'afternoon' | 'either'
      }>
    >()
    if (!allRsvps) return map
    for (const r of allRsvps) {
      if (!map.has(r.sessionId)) map.set(r.sessionId, [])
      map.get(r.sessionId)!.push(r)
    }
    return map
  }, [allRsvps])

  // --- Early returns (all hooks are above) ---

  if (org === undefined || data === undefined) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-24 bg-slate-100 rounded-xl" />
              <div className="h-64 bg-slate-100 rounded-xl" />
            </div>
          </div>
        </main>
      </GradientBg>
    )
  }

  if (org === null || data === null) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Building2 className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              {org === null ? 'Organization Not Found' : 'Program Not Found'}
            </h1>
            <p className="text-slate-600 mb-6">
              {org === null
                ? "This organization doesn't exist."
                : "This program doesn't exist or you don't have access."}
            </p>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to {org?.name ?? 'Organization'}
              </Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  const { program, participation } = data

  return (
    <AISidebarProvider moduleId={participation ? effectiveModuleId : null}>
      <GradientBg>
        <AuthHeader />
        <AISidebar />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <Card className="p-6 mb-6">
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                <Link
                  to="/org/$slug"
                  params={{ slug }}
                  className="hover:text-slate-700 transition-colors"
                >
                  {org.name}
                </Link>
                <span>/</span>
                <Link
                  to="/org/$slug/programs"
                  params={{ slug }}
                  className="hover:text-slate-700 transition-colors"
                >
                  Programs
                </Link>
                <span>/</span>
                <span className="text-slate-700">{program.name}</span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-display text-foreground">
                      {program.name}
                    </h1>
                    <Badge className="bg-green-100 text-green-700">
                      {program.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <span>{programTypeLabels[program.type]}</span>
                    {program.startDate && (
                      <>
                        <span>·</span>
                        <span>
                          {new Date(program.startDate).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: 'numeric' },
                          )}
                          {program.endDate &&
                            ` – ${new Date(program.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {participation && (
                    <Badge
                      className={
                        participation.status === 'completed'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-green-50 text-green-700 border-green-200'
                      }
                    >
                      {participation.status === 'completed' ? (
                        <>
                          <CheckCircle2 className="size-3 mr-1" />
                          Completed
                        </>
                      ) : (
                        'Enrolled'
                      )}
                    </Badge>
                  )}
                  {participation && <AISidebarToggle />}
                </div>
              </div>

              {program.description && (
                <p className="text-slate-600 mt-4 whitespace-pre-line">
                  {program.description}
                </p>
              )}
            </Card>

            {/* Live Session Banner */}
            {participation && sessions.length > 0 && (
              <ParticipantLiveView sessions={sessions} />
            )}

            {/* Time-to-session indicator */}
            <TimeToSessionIndicator
              sessions={sessions}
              modules={modules}
              progressMap={progressMap}
            />

            {/* Session Timeline */}
            {sessions.length > 0 && (
              <SessionTimeline
                sessions={sessions}
                modules={modules}
                myRsvps={myRsvps}
                myAttendance={myAttendance}
                progressMap={progressMap}
                rsvpsBySession={rsvpsBySession}
                allRsvpsLoaded={allRsvps !== undefined}
                onModuleClick={setActiveModuleId}
                continueHere={continueHere}
              />
            )}

            {/* Unlinked Modules (not linked to any session) */}
            <UnlinkedModules
              modules={modules}
              sessions={sessions}
              progressMap={progressMap}
              onModuleClick={setActiveModuleId}
              continueHere={continueHere}
            />

            {/* My Progress */}
            {participation && (
              <ProgressSection
                participation={participation}
                myAttendance={myAttendance}
                myMaterialProgress={myMaterialProgress}
                modules={modules}
                program={program}
              />
            )}
          </div>
        </main>
      </GradientBg>
    </AISidebarProvider>
  )
}

// ============================================================
// Session Timeline
// ============================================================

// ============================================================
// Time-to-Session Indicator
// ============================================================

function TimeToSessionIndicator({
  sessions,
  modules,
  progressMap,
}: {
  sessions: Array<{
    _id: Id<'programSessions'>
    date: number
    dayNumber: number
    title: string
  }>
  modules: Array<{
    _id: Id<'programModules'>
    linkedSessionId?: Id<'programSessions'>
    materials?: Array<{
      estimatedMinutes?: number
      isEssential?: boolean
    }>
    status: string
  }>
  progressMap: Map<string, Set<number>>
}) {
  const nextSession = sessions.find((s) => daysUntilSession(s.date) >= 0)
  if (!nextSession) return null

  const days = daysUntilSession(nextSession.date)
  if (days < 0) return null

  // Compute remaining essential pre-work minutes for linked modules
  const linkedModules = modules.filter(
    (m) => m.linkedSessionId === nextSession._id && m.status !== 'locked',
  )
  const remainingMinutes = linkedModules.reduce((sum, mod) => {
    const completed = progressMap.get(mod._id)
    return (
      sum +
      (mod.materials ?? []).reduce((mSum, mat, i) => {
        if (mat.isEssential === false) return mSum
        if (completed?.has(i)) return mSum
        return mSum + (mat.estimatedMinutes ?? 0)
      }, 0)
    )
  }, 0)

  const daysLabel =
    days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`
  const hours = Math.floor(remainingMinutes / 60)
  const mins = remainingMinutes % 60
  const timeLabel =
    remainingMinutes === 0
      ? 'All pre-work complete'
      : hours > 0
        ? `~${hours}h ${mins}m pre-work remaining`
        : `~${mins}m pre-work remaining`

  return (
    <Card className="p-4 mb-6 border-blue-200 bg-blue-50/50">
      <div className="flex items-center gap-2 text-sm">
        <Clock className="size-4 text-blue-600" />
        <span className="font-medium text-blue-900">{nextSession.title}</span>
        <span className="text-blue-700">· {daysLabel}</span>
        <span className="text-blue-600">· {timeLabel}</span>
      </div>
    </Card>
  )
}

type ContinueHere = {
  moduleId: Id<'programModules'>
  materialIndex: number | null
  type: 'material' | 'prompt'
} | null

function SessionTimeline({
  sessions,
  modules,
  myRsvps,
  myAttendance,
  progressMap,
  rsvpsBySession,
  allRsvpsLoaded,
  onModuleClick,
  continueHere,
}: {
  sessions: Array<{
    _id: Id<'programSessions'>
    dayNumber: number
    title: string
    date: number
    morningStartTime: string
    afternoonStartTime: string
    lumaUrl?: string
  }>
  modules: Array<{
    _id: Id<'programModules'>
    title: string
    description?: string
    weekNumber: number
    orderIndex: number
    linkedSessionId?: Id<'programSessions'>
    materials?: Array<{
      label: string
      url?: string
      type: 'link' | 'pdf' | 'video' | 'reading' | 'audio'
      estimatedMinutes?: number
      isEssential?: boolean
      storageId?: string
      audioUrl?: string
    }>
    status: 'locked' | 'available' | 'completed'
  }>
  myRsvps: Array<{
    sessionId: Id<'programSessions'>
    preference: 'morning' | 'afternoon' | 'either'
  }>
  myAttendance: Array<{
    sessionId: Id<'programSessions'>
    slot: 'morning' | 'afternoon'
  }>
  progressMap: Map<string, Set<number>>
  rsvpsBySession: Map<
    string,
    Array<{
      userId: string
      userName: string
      preference: 'morning' | 'afternoon' | 'either'
    }>
  >
  allRsvpsLoaded: boolean
  onModuleClick: (id: Id<'programModules'>) => void
  continueHere: ContinueHere
}) {
  const rsvpMap = useMemo(
    () => new Map(myRsvps.map((r) => [r.sessionId, r.preference])),
    [myRsvps],
  )

  const attendanceMap = useMemo(
    () => new Map(myAttendance.map((a) => [a.sessionId, a.slot])),
    [myAttendance],
  )

  // Pre-group modules by linkedSessionId to avoid O(S*M) filtering per render
  const modulesBySession = useMemo(() => {
    const map = new Map<string, typeof modules>()
    for (const m of modules) {
      if (
        m.linkedSessionId &&
        (m.status === 'available' || m.status === 'completed')
      ) {
        if (!map.has(m.linkedSessionId)) map.set(m.linkedSessionId, [])
        map.get(m.linkedSessionId)!.push(m)
      }
    }
    return map
  }, [modules])

  const now = Date.now()

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        <Calendar className="size-5" />
        Sessions
      </h2>
      <div className="space-y-4">
        {sessions.map((session) => {
          const linkedModules = modulesBySession.get(session._id) ?? []
          const currentRsvp = rsvpMap.get(session._id)
          const attendedSlot = attendanceMap.get(session._id)
          const isPast = session.date < now - 24 * 60 * 60 * 1000 // Past if >24h ago

          return (
            <Card
              key={session._id}
              className={`p-5 ${isPast && !attendedSlot ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      Day {session.dayNumber}
                    </span>
                    {attendedSlot && (
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle2 className="size-3 mr-1" />
                        Attended (
                        {attendedSlot === 'morning' ? 'Morning' : 'Afternoon'})
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-medium text-foreground">
                    {session.title}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {new Date(session.date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · Morning {session.morningStartTime} · Afternoon{' '}
                    {session.afternoonStartTime}
                  </p>
                </div>
              </div>

              {/* RSVP selector (only for future sessions not yet attended) */}
              {!attendedSlot && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Your slot:
                  </p>
                  <RsvpSelector
                    sessionId={session._id}
                    currentPreference={currentRsvp}
                  />
                </div>
              )}

              {/* Pre-work materials */}
              {linkedModules.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Pre-work:
                  </p>
                  {linkedModules.map((mod) => (
                    <div key={mod._id} onClick={() => onModuleClick(mod._id)}>
                      {mod.materials && mod.materials.length > 0 && (
                        <MaterialChecklist
                          moduleId={mod._id}
                          materials={mod.materials}
                          completedIndexes={
                            progressMap.get(mod._id) ?? EMPTY_SET
                          }
                          continueHereIndex={
                            continueHere?.moduleId === mod._id &&
                            continueHere.type === 'material'
                              ? (continueHere.materialIndex ?? undefined)
                              : undefined
                          }
                        />
                      )}
                      <ModulePrompts
                        moduleId={mod._id}
                        isContinueHere={
                          continueHere?.moduleId === mod._id &&
                          continueHere.type === 'prompt'
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Who's coming */}
              {allRsvpsLoaded && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Who's coming:
                  </p>
                  <RsvpGrid
                    rsvps={rsvpsBySession.get(session._id) ?? EMPTY_RSVPS}
                  />
                </div>
              )}
              {!allRsvpsLoaded && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Spinner className="size-3" />
                  Loading RSVPs...
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </section>
  )
}

// ============================================================
// Unlinked Modules
// ============================================================

function UnlinkedModules({
  modules,
  sessions,
  progressMap,
  onModuleClick,
  continueHere,
}: {
  modules: Array<{
    _id: Id<'programModules'>
    title: string
    description?: string
    weekNumber: number
    orderIndex: number
    linkedSessionId?: Id<'programSessions'>
    materials?: Array<{
      label: string
      url?: string
      type: 'link' | 'pdf' | 'video' | 'reading' | 'audio'
      estimatedMinutes?: number
      isEssential?: boolean
      storageId?: string
      audioUrl?: string
    }>
    status: 'locked' | 'available' | 'completed'
  }>
  sessions: Array<{ _id: Id<'programSessions'> }>
  progressMap: Map<string, Set<number>>
  onModuleClick: (id: Id<'programModules'>) => void
  continueHere: ContinueHere
}) {
  const sessionIds = new Set(sessions.map((s) => s._id))
  const unlinkedVisible = modules.filter(
    (m) =>
      (m.status === 'available' || m.status === 'completed') &&
      (!m.linkedSessionId || !sessionIds.has(m.linkedSessionId)),
  )
  const lockedModules = modules.filter((m) => m.status === 'locked')

  if (unlinkedVisible.length === 0 && lockedModules.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        <GraduationCap className="size-5" />
        Curriculum
      </h2>
      <div className="space-y-3">
        {unlinkedVisible.map((mod) => (
          <Card
            key={mod._id}
            className="p-5"
            onClick={() => onModuleClick(mod._id)}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    Week {mod.weekNumber}
                  </span>
                  {mod.status === 'completed' && (
                    <CheckCircle2 className="size-4 text-green-600" />
                  )}
                </div>
                <h3 className="font-medium text-foreground mt-1">
                  {mod.title}
                </h3>
              </div>
            </div>
            {mod.description && (
              <p className="text-sm text-slate-600 mb-3">{mod.description}</p>
            )}
            {mod.materials && mod.materials.length > 0 && (
              <MaterialChecklist
                moduleId={mod._id}
                materials={mod.materials}
                completedIndexes={progressMap.get(mod._id) ?? EMPTY_SET}
                continueHereIndex={
                  continueHere?.moduleId === mod._id &&
                  continueHere.type === 'material'
                    ? (continueHere.materialIndex ?? undefined)
                    : undefined
                }
              />
            )}
            <ModulePrompts
              moduleId={mod._id}
              isContinueHere={
                continueHere?.moduleId === mod._id &&
                continueHere.type === 'prompt'
              }
            />
          </Card>
        ))}

        {lockedModules.length > 0 && (
          <Card className="p-4 bg-slate-50 border-dashed">
            <div className="flex items-center gap-2 text-slate-500">
              <Lock className="size-4" />
              <span className="text-sm">
                {lockedModules.length} more module
                {lockedModules.length > 1 ? 's' : ''} coming soon
              </span>
            </div>
          </Card>
        )}
      </div>
    </section>
  )
}

// ============================================================
// Progress Section
// ============================================================

function ProgressSection({
  participation,
  myAttendance,
  myMaterialProgress,
  modules,
  program,
}: {
  participation: {
    status: string
    enrolledAt: number
    completedAt?: number
  }
  myAttendance: Array<{
    sessionId: Id<'programSessions'>
    slot: 'morning' | 'afternoon'
  }>
  myMaterialProgress: Array<{
    moduleId: Id<'programModules'>
    materialIndex: number
  }>
  modules: Array<{
    _id: Id<'programModules'>
    materials?: Array<{ isEssential?: boolean }>
    status: string
  }>
  program: {
    completionCriteria?: {
      type: string
      requiredCount?: number
    }
  }
}) {
  const sessionsAttended = myAttendance.length
  const requiredSessions =
    program.completionCriteria?.type === 'attendance_count'
      ? program.completionCriteria.requiredCount
      : undefined

  // Count only essential materials
  const totalMaterials = modules
    .filter((m) => m.status !== 'locked')
    .reduce(
      (sum, m) =>
        sum +
        (m.materials?.filter((mat) => mat.isEssential !== false).length ?? 0),
      0,
    )

  // Count completed essential materials only
  const completedMaterials = myMaterialProgress.filter((p) => {
    const mod = modules.find((m) => m._id === p.moduleId)
    if (!mod?.materials?.[p.materialIndex]) return false
    return mod.materials[p.materialIndex].isEssential !== false
  }).length

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3">
        My Progress
      </h2>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-slate-500 mb-1">Status</p>
            <Badge
              className={
                participation.status === 'completed'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }
            >
              {participation.status}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-slate-500 mb-1">Sessions Attended</p>
            <p className="text-foreground font-medium">
              {sessionsAttended}
              {requiredSessions !== undefined &&
                ` / ${requiredSessions} required`}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500 mb-1">Materials Completed</p>
            <p className="text-foreground font-medium">
              {completedMaterials}
              {totalMaterials > 0 && ` / ${totalMaterials}`}
            </p>
          </div>
        </div>
      </Card>
    </section>
  )
}
