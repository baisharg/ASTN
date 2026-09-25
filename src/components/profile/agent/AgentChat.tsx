import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
} from '@convex-dev/agent/react'
import {
  AlertTriangle,
  Check,
  ChevronsDown,
  Copy,
  Eye,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { ErrorInfo, ReactNode } from 'react'
import type { UIMessage } from '@convex-dev/agent'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import type { AgentPageContext } from '~/hooks/use-agent-page-context'
import { useAgentSidebar } from '~/components/agent-sidebar/AgentSidebarProvider'
import { useSmartInput } from '~/components/agent-sidebar/useSmartInput'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/utils'
import { renderMarkdown } from '~/lib/render-markdown'

// ErrorBoundary to prevent one bad message from crashing the entire chat
class MessageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('MessageErrorBoundary caught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-xs text-muted-foreground italic px-4 py-1">
          (message could not be displayed)
        </div>
      )
    }
    return this.props.children
  }
}

interface AgentChatProps {
  profileId: Id<'profiles'>
  threadId: string
  pageContext?: AgentPageContext
  isOpen?: boolean
}

export function AgentChat({
  profileId,
  threadId,
  pageContext,
  isOpen,
}: AgentChatProps) {
  const [input, setInput] = useState('')
  const [autoApprove, setAutoApprove] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('agent-auto-approve') !== 'false'
  })
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const userScrolledUpRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const navigate = useNavigate()

  // Smart input: LinkedIn URLs, CV pastes, file uploads
  const smartInput = useSmartInput({ profileId, threadId })

  // Messages with streaming
  const { results: messages } = useUIMessages(
    api.agent.queries.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  )

  // Tool calls for approve/undo
  const toolCalls = useQuery(api.agent.queries.getToolCalls, {
    threadId,
  })

  // Mutations
  const sendMessageMut = useMutation(
    api.agent.threadOps.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.agent.queries.listMessages),
  )
  const resolveToolChange = useMutation(api.agent.mutations.resolveToolChange)
  const approveProposal = useMutation(api.agent.mutations.approveProposal)
  const denyProposal = useMutation(api.agent.mutations.denyProposal)
  const batchApprove = useMutation(api.agent.mutations.batchApprovePending)
  const abortGeneration = useMutation(api.agent.threadOps.abortGeneration)
  const createThread = useMutation(api.agent.threadOps.createAgentThread)
  const deleteMessagesFrom = useMutation(api.agent.threadOps.deleteMessagesFrom)

  // Check if agent is currently responding
  const isStreaming = messages.some((m: UIMessage) => m.status === 'streaming')
  const isLoading =
    isStreaming || messages.some((m: UIMessage) => m.status === 'pending')

  // Persist auto-approve preference
  useEffect(() => {
    localStorage.setItem('agent-auto-approve', String(autoApprove))
  }, [autoApprove])

  // Auto-approve new tool calls when toggle is on (skip manual-approval items)
  // Ref tracks in-flight mutation IDs to prevent duplicate concurrent calls
  const processingIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!autoApprove || !toolCalls) return
    for (const tc of toolCalls) {
      if (tc.requiresManualApproval) continue
      if (processingIdsRef.current.has(tc._id)) continue
      if (tc.status === 'proposed') {
        processingIdsRef.current.add(tc._id)
        void approveProposal({ toolCallId: tc._id }).finally(() =>
          processingIdsRef.current.delete(tc._id),
        )
      } else if (tc.status === 'pending') {
        processingIdsRef.current.add(tc._id)
        void resolveToolChange({
          toolCallId: tc._id,
          action: 'approve',
        }).finally(() => processingIdsRef.current.delete(tc._id))
      }
    }
  }, [autoApprove, toolCalls, resolveToolChange, approveProposal])

  // Track user scroll to determine if they scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const atBottom = scrollHeight - scrollTop - clientHeight < 40
      userScrolledUpRef.current = !atBottom
      setShowScrollToBottom(!atBottom)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll on new messages, unless user scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // Continuously pin to bottom while streaming
  useEffect(() => {
    if (!isStreaming || userScrolledUpRef.current) return
    const container = messagesContainerRef.current
    if (!container) return

    let raf: number
    const tick = () => {
      container.scrollTop = container.scrollHeight
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isStreaming])

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Focus input when sidebar opens (or on mount)
  useEffect(() => {
    if (isOpen === undefined || isOpen) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Auto-send pending message from openWithMessage()
  const { pendingMessage, clearPendingMessage } = useAgentSidebar()

  useEffect(() => {
    if (!pendingMessage) return
    if (!threadId || !profileId) return
    if (isLoading) return

    const sendPending = async () => {
      clearPendingMessage()
      userScrolledUpRef.current = false
      setShowScrollToBottom(false)

      await sendMessageMut({
        threadId,
        prompt: pendingMessage,
        profileId,
        pageContext: pageContext?.type,
        pageContextEntityId: pageContext?.entityId,
        browserLocale:
          typeof navigator !== 'undefined' ? navigator.language : undefined,
      })
    }

    void sendPending()
  }, [pendingMessage, threadId, profileId, isLoading])

  // Find the last user message key for edit button
  const lastUserMessageKey = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].key
    }
    return null
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading || smartInput.isProcessing) return

    // Check for LinkedIn URLs or CV-like text pastes
    if (smartInput.detectAndHandle(text)) {
      // LinkedIn: clear input, extraction started
      // CV confirm: keep input, banner shows for user to decide
      if (!smartInput.showCVConfirm) {
        setInput('')
      }
      return
    }

    setInput('')
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)

    // Batch-approve pending tool calls on send (skip when auto-approve handles it)
    if (!autoApprove) {
      void batchApprove({ threadId })
    }

    await sendMessageMut({
      threadId,
      prompt: text,
      profileId,
      pageContext: pageContext?.type,
      pageContextEntityId: pageContext?.entityId,
      browserLocale:
        typeof navigator !== 'undefined' ? navigator.language : undefined,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit(e)
    }
  }

  const handleStop = () => {
    void abortGeneration({ threadId })
  }

  const handleNewConversation = () => {
    void createThread({ profileId })
  }

  const handleEditMessage = (text: string, order: number) => {
    void deleteMessagesFrom({ threadId, startOrder: order })
    setInput(text)
    textareaRef.current?.focus()
  }

  // Associate tool calls with assistant messages by creation time
  const allToolCalls = toolCalls ?? []

  const getToolCallsForMessage = (
    message: UIMessage,
    nextMessage: UIMessage | undefined,
  ): Array<Doc<'agentToolCalls'>> => {
    if (message.role !== 'assistant') return []
    return allToolCalls.filter((tc: Doc<'agentToolCalls'>) => {
      if (tc.createdAt < message._creationTime) return false
      if (nextMessage && tc.createdAt >= nextMessage._creationTime) return false
      return true
    })
  }

  // Intercept clicks on internal links for SPA navigation
  const handleMessagesClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a[href]')
      if (!target) return
      const href = target.getAttribute('href')
      if (href && href.startsWith('/')) {
        e.preventDefault()
        void navigate({ to: href })
      }
    },
    [navigate],
  )

  // Context label for pages where rich data is loaded into the agent
  const contextLabel = (() => {
    if (!pageContext) return null
    switch (pageContext.type) {
      case 'viewing_match':
        return pageContext.entityId
          ? 'Seeing match details & fit analysis'
          : null
      case 'viewing_opportunity':
        return pageContext.entityId ? 'Seeing opportunity details' : null
      case 'browsing_matches':
        return 'Seeing your match overview'
      case 'event_profile':
        return 'Setting up your event profile'
      default:
        return null
    }
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header with auto-approve toggle and new conversation button */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background/50">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-coral-400" />
          <span className="text-sm font-medium">Career Advisor</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={isLoading || messages.length === 0}
            onClick={handleNewConversation}
            title="New conversation"
          >
            <Plus className="size-4" />
          </Button>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">Auto-approve</span>
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          </label>
        </div>
      </div>

      {/* Page context indicator */}
      {contextLabel && (
        <div className="px-4 py-1.5 border-b bg-muted/30 flex items-center gap-2">
          <Eye className="size-3 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">{contextLabel}</span>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        className="relative flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 space-y-4"
        onClick={handleMessagesClick}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="size-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">
              Hey! Let's build your profile
            </h3>
            <p className="text-muted-foreground text-sm max-w-xs mb-6">
              I'll help you create your AI safety profile. Pick a starting
              point:
            </p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                type="button"
                onClick={() => {
                  setInput("Here's my LinkedIn: ")
                  textareaRef.current?.focus()
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-accent text-left text-sm transition-colors"
              >
                <Link2 className="size-4 text-muted-foreground shrink-0" />
                <span>Paste a LinkedIn URL</span>
              </button>
              <button
                type="button"
                onClick={() => smartInput.fileInputRef.current?.click()}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-accent text-left text-sm transition-colors"
              >
                <Upload className="size-4 text-muted-foreground shrink-0" />
                <span>Upload your CV or resume</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput("I'm interested in AI safety because ")
                  textareaRef.current?.focus()
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-accent text-left text-sm transition-colors"
              >
                <MessageSquare className="size-4 text-muted-foreground shrink-0" />
                <span>Just start chatting</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message: UIMessage, idx: number) => (
              <MessageErrorBoundary key={message.key}>
                <MessageBubble
                  message={message}
                  relatedToolCalls={getToolCallsForMessage(
                    message,
                    messages[idx + 1],
                  )}
                  autoApprove={autoApprove}
                  onApprove={(id) =>
                    resolveToolChange({ toolCallId: id, action: 'approve' })
                  }
                  onUndo={(id) =>
                    resolveToolChange({ toolCallId: id, action: 'undo' })
                  }
                  onApproveProposal={(id) =>
                    approveProposal({ toolCallId: id })
                  }
                  onDenyProposal={async (id, displayText) => {
                    await denyProposal({ toolCallId: id })
                    await sendMessageMut({
                      threadId,
                      prompt: `[I rejected: "${displayText}"]`,
                      profileId,
                    })
                  }}
                  isLastUserMessage={message.key === lastUserMessageKey}
                  onEdit={handleEditMessage}
                />
              </MessageErrorBoundary>
            ))}

            {/* Loading dots when waiting for first token */}
            {isLoading && !isStreaming && (
              <div className="flex justify-start animate-in fade-in duration-200">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="size-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                    <span
                      className="size-2 bg-muted-foreground/50 rounded-full animate-bounce"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <span
                      className="size-2 bg-muted-foreground/50 rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />

        {/* Scroll-to-bottom FAB */}
        {showScrollToBottom && messages.length > 0 && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none">
            <Button
              variant="outline"
              size="icon"
              className="pointer-events-auto size-8 rounded-full shadow-md bg-background/90 backdrop-blur-sm"
              onClick={scrollToBottom}
            >
              <ChevronsDown className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Extraction progress / error / CV confirmation */}
      {smartInput.isProcessing && smartInput.progressText && (
        <div className="px-4 py-2 border-t bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin shrink-0" />
            <span>{smartInput.progressText}</span>
          </div>
        </div>
      )}

      {smartInput.error && (
        <div className="px-4 py-2 border-t bg-red-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-red-700">
            <AlertTriangle className="size-3 shrink-0" />
            <span>
              {typeof smartInput.error === 'string'
                ? smartInput.error
                : String(smartInput.error)}
            </span>
          </div>
          <button
            onClick={smartInput.dismissError}
            className="text-red-400 hover:text-red-600"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {smartInput.showCVConfirm && (
        <div className="px-4 py-2 border-t bg-amber-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-amber-800">
            <FileText className="size-3 shrink-0" />
            <span>Looks like a CV/resume. Import profile data?</span>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                smartInput.cancelCVPaste()
              }}
            >
              Skip
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                smartInput.confirmCVPaste()
                setInput('')
              }}
            >
              Import
            </Button>
          </div>
        </div>
      )}

      {smartInput.showLinkedInConfirm && smartInput.pendingLinkedInData && (
        <div className="px-4 py-2 border-t bg-blue-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-blue-800 min-w-0">
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">
              {smartInput.pendingLinkedInData.name
                ? `${smartInput.pendingLinkedInData.name}`
                : 'LinkedIn profile found'}
              {(() => {
                const currentJob =
                  smartInput.pendingLinkedInData.workHistory?.find(
                    (w) => !w.endDate || w.endDate.toLowerCase() === 'present',
                  )
                return currentJob
                  ? ` — ${currentJob.title} at ${currentJob.organization}`
                  : ''
              })()}
            </span>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={smartInput.cancelLinkedInImport}
            >
              Not me
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={smartInput.confirmLinkedInImport}
            >
              This is my profile
            </Button>
          </div>
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t p-2 sm:p-3 md:p-4 flex gap-2 items-end bg-muted/50"
      >
        {/* File upload button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isLoading || smartInput.isProcessing}
          onClick={() => smartInput.fileInputRef.current?.click()}
          className="shrink-0 size-9"
          title="Upload CV/resume"
        >
          <Paperclip className="size-4" />
        </Button>
        <input
          ref={smartInput.fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) smartInput.handleFileSelect(file)
            e.target.value = ''
          }}
        />
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            messages.length === 0
              ? 'Paste LinkedIn URL, drop a CV, or just type...'
              : 'Continue the conversation...'
          }
          disabled={isLoading || smartInput.isProcessing}
          className="flex-1 min-h-9 max-h-[120px] resize-none"
          rows={1}
        />
        {isLoading ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="shrink-0"
            onClick={handleStop}
            title="Stop generating"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!input.trim() || smartInput.isProcessing}
            size="icon"
            className="shrink-0"
          >
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </div>
  )
}

// Map tool part type names to agentToolCalls toolName values
function getToolNameFromPart(part: {
  type: string
  toolName?: string
}): string | null {
  if (part.type === 'dynamic-tool' && 'toolName' in part)
    return part.toolName ?? null
  if (part.type.startsWith('tool-')) return part.type.slice(5)
  return null
}

// Inline copy button for text content
function CopyableText({
  text,
  children,
}: {
  text: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className="group/copy relative">
      {children}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute -top-2 -right-2 size-6 rounded-md bg-background border shadow-sm flex items-center justify-center opacity-0 group-hover/copy:opacity-100 transition-opacity"
        title="Copy message"
      >
        {copied ? (
          <Check className="size-3 text-green-600" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </button>
    </div>
  )
}

// Individual message bubble component
function MessageBubble({
  message,
  relatedToolCalls,
  autoApprove,
  onApprove,
  onUndo,
  onApproveProposal,
  onDenyProposal,
  isLastUserMessage,
  onEdit,
}: {
  message: UIMessage
  relatedToolCalls: Array<Doc<'agentToolCalls'>>
  autoApprove: boolean
  onApprove: (id: Id<'agentToolCalls'>) => void
  onUndo: (id: Id<'agentToolCalls'>) => void
  onApproveProposal: (id: Id<'agentToolCalls'>) => void
  onDenyProposal: (id: Id<'agentToolCalls'>, displayText: string) => void
  isLastUserMessage?: boolean
  onEdit?: (text: string, order: number) => void
}) {
  // Guard: ensure text is always a string (defensive — runtime type may differ)
  const rawText = message.text as unknown
  const messageText =
    typeof rawText === 'string'
      ? rawText
      : typeof rawText === 'object'
        ? JSON.stringify(rawText)
        : String(rawText as string | number)
  const [smoothText] = useSmoothText(messageText, {
    startStreaming: message.status === 'streaming',
  })

  if (message.role === 'user') {
    return (
      <div className="group/edit flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-300">
        {isLastUserMessage && onEdit && messageText && (
          <button
            type="button"
            onClick={() => onEdit(messageText, message.order)}
            className="self-center mr-1 size-6 rounded-md flex items-center justify-center opacity-0 group-hover/edit:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            title="Edit message"
          >
            <Pencil className="size-3" />
          </button>
        )}
        <div className="max-w-[95%] md:max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary text-primary-foreground">
          <p className="text-sm whitespace-pre-wrap">{messageText}</p>
        </div>
      </div>
    )
  }

  const isStreamingMsg = message.status === 'streaming'

  // When streaming, render as a single block (parts may not be finalized)
  if (isStreamingMsg) {
    return (
      <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {smoothText && (
          <CopyableText text={smoothText}>
            <div className="flex justify-start">
              <div className="max-w-[95%] md:max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-muted text-foreground">
                <p className="text-sm whitespace-pre-wrap">
                  {renderMarkdown(smoothText)}
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-muted-foreground/70 animate-pulse align-text-bottom" />
                </p>
              </div>
            </div>
          </CopyableText>
        )}
      </div>
    )
  }

  // When complete, render parts inline with tool calls interleaved
  const parts = message.parts
  const matchedToolCallIds = new Set<string>()
  // Track which tool calls we've matched to parts (by toolName, in order)
  const toolCallsByName = new Map<string, Array<Doc<'agentToolCalls'>>>()
  for (const tc of relatedToolCalls) {
    const existing = toolCallsByName.get(tc.toolName) ?? []
    existing.push(tc)
    toolCallsByName.set(tc.toolName, existing)
  }
  const toolCallCursors = new Map<string, number>()

  const elements: Array<React.ReactNode> = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    // Guard: ensure part.text is a string (defensive — runtime type may differ)
    const rawPartText = part.type === 'text' ? (part.text as unknown) : null
    const partText =
      rawPartText != null
        ? typeof rawPartText === 'string'
          ? rawPartText
          : typeof rawPartText === 'object'
            ? JSON.stringify(rawPartText)
            : String(rawPartText as string | number)
        : null
    if (partText) {
      elements.push(
        <CopyableText key={`text-${i}`} text={partText}>
          <div className="flex justify-start">
            <div className="max-w-[95%] md:max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-muted text-foreground">
              <p className="text-sm whitespace-pre-wrap">
                {renderMarkdown(partText)}
              </p>
            </div>
          </div>
        </CopyableText>,
      )
    } else if (
      part.type === 'step-start' ||
      part.type === 'reasoning' ||
      part.type === 'file' ||
      part.type.startsWith('source-') ||
      part.type.startsWith('data-')
    ) {
      // Known non-renderable part types — skip silently
    } else {
      // Tool part — match to agentToolCalls
      const toolName = getToolNameFromPart(
        part as { type: string; toolName?: string },
      )
      if (toolName) {
        const candidates = toolCallsByName.get(toolName) ?? []
        const cursor = toolCallCursors.get(toolName) ?? 0
        if (cursor < candidates.length) {
          const tc = candidates[cursor]
          toolCallCursors.set(toolName, cursor + 1)
          matchedToolCallIds.add(tc._id)
          elements.push(
            <ToolCallCard
              key={tc._id}
              toolCall={tc}
              autoApprove={autoApprove}
              onApprove={() => onApprove(tc._id)}
              onUndo={() => onUndo(tc._id)}
              onApproveProposal={() => onApproveProposal(tc._id)}
              onDenyProposal={() => onDenyProposal(tc._id, tc.displayText)}
            />,
          )
        }
      } else {
        // Unknown part type — skip but log for debugging
        console.warn('AgentChat: unhandled message part type:', part.type)
      }
    }
  }

  // Safety net: render any remaining unmatched tool calls
  for (const tc of relatedToolCalls) {
    if (!matchedToolCallIds.has(tc._id)) {
      elements.push(
        <ToolCallCard
          key={tc._id}
          toolCall={tc}
          autoApprove={autoApprove}
          onApprove={() => onApprove(tc._id)}
          onUndo={() => onUndo(tc._id)}
          onApproveProposal={() => onApproveProposal(tc._id)}
          onDenyProposal={() => onDenyProposal(tc._id, tc.displayText)}
        />,
      )
    }
  }

  if (elements.length === 0) return null

  return (
    <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {elements}
    </div>
  )
}

// Format a diff between old and new values for display
function renderDiffLines(
  updates: Record<string, unknown>,
  previousValues: Record<string, unknown>,
): Array<{
  field: string
  old: string
  new: string
  type: 'scalar' | 'array' | 'object'
}> {
  const lines: Array<{
    field: string
    old: string
    new: string
    type: 'scalar' | 'array' | 'object'
  }> = []

  for (const key of Object.keys(updates)) {
    const newVal = updates[key]
    const oldVal = previousValues[key]

    if (Array.isArray(newVal)) {
      const oldArr = Array.isArray(oldVal) ? oldVal : []
      // For arrays of objects (education, workHistory), show as object
      if (newVal.length > 0 && typeof newVal[0] === 'object') {
        lines.push({
          field: key,
          old: oldArr.length > 0 ? JSON.stringify(oldArr) : '',
          new: JSON.stringify(newVal),
          type: 'object',
        })
      } else {
        // Simple arrays (skills, interests) — show +added / -removed
        const oldSet = new Set(oldArr.map(String))
        const newSet = new Set(newVal.map(String))
        const added = newVal.filter((v: unknown) => !oldSet.has(String(v)))
        const removed = oldArr.filter((v: unknown) => !newSet.has(String(v)))
        lines.push({
          field: key,
          old: removed.length > 0 ? removed.map(String).join(', ') : '',
          new: added.length > 0 ? added.map(String).join(', ') : '',
          type: 'array',
        })
      }
    } else if (typeof newVal === 'object' && newVal !== null) {
      lines.push({
        field: key,
        old: oldVal ? JSON.stringify(oldVal) : '',
        new: JSON.stringify(newVal),
        type: 'object',
      })
    } else {
      lines.push({
        field: key,
        old:
          oldVal != null
            ? typeof oldVal === 'object'
              ? JSON.stringify(oldVal)
              : String(oldVal as string | number)
            : '',
        new:
          newVal != null
            ? typeof newVal === 'object'
              ? JSON.stringify(newVal)
              : String(newVal as string | number)
            : '',
        type: 'scalar',
      })
    }
  }

  return lines
}

// Pretty field name for display
function prettyFieldName(field: string): string {
  const map: Record<string, string> = {
    name: 'Name',
    pronouns: 'Pronouns',
    location: 'Location',
    headline: 'Headline',
    linkedinUrl: 'LinkedIn',
    education: 'Education',
    workHistory: 'Work experience',
    skills: 'Skills',
    careerGoals: 'Career goals',
    aiSafetyInterests: 'AI safety interests',
    seeking: 'Looking for',
    matchPreferences: 'Match preferences',
    preferredLanguage: 'Language',
  }
  return map[field] ?? field
}

// Format education/work entries for display
function formatEntries(json: string, field: string): string {
  try {
    const arr = JSON.parse(json) as Array<Record<string, unknown>>
    if (field === 'education') {
      return arr
        .map(
          (e) =>
            `${e.degree ? `${String(e.degree as string)} ` : ''}${e.field ? `in ${String(e.field as string)} ` : ''}at ${String(e.institution as string)}`,
        )
        .join('; ')
    }
    if (field === 'workHistory') {
      return arr
        .map((w) => `${String(w.title)} at ${String(w.organization)}`)
        .join('; ')
    }
    if (field === 'matchPreferences') {
      const parts: Array<string> = []
      for (const [k, v] of Object.entries(arr.length ? arr[0] : {})) {
        if (v != null)
          parts.push(
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v as string | number)}`,
          )
      }
      return parts.join('; ')
    }
    return json
  } catch {
    return json
  }
}

// Unified tool call card — handles proposed, denied, pending, approved, undone
function ToolCallCard({
  toolCall,
  autoApprove,
  onApprove,
  onUndo,
  onApproveProposal,
  onDenyProposal,
}: {
  toolCall: Doc<'agentToolCalls'>
  autoApprove: boolean
  onApprove: () => void
  onUndo: () => void
  onApproveProposal: () => void
  onDenyProposal: () => void
}) {
  const { status, displayText } = toolCall
  const rawDisplayText = displayText as unknown
  const safeDisplayText =
    typeof rawDisplayText === 'string'
      ? rawDisplayText
      : typeof rawDisplayText === 'object'
        ? JSON.stringify(rawDisplayText)
        : String(rawDisplayText as string | number)

  // Proposed: show diff view with approve/deny
  if (status === 'proposed') {
    let diffLines: Array<{
      field: string
      old: string
      new: string
      type: 'scalar' | 'array' | 'object'
    }> = []
    try {
      const updates = JSON.parse(toolCall.updates) as Record<string, unknown>
      const prev = JSON.parse(toolCall.previousValues) as Record<
        string,
        unknown
      >
      diffLines = renderDiffLines(updates, prev)
    } catch {
      // Fallback: just show display text
    }

    return (
      <div className="max-w-[95%] md:max-w-[80%] rounded-lg border border-blue-200 bg-blue-50 text-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-blue-100">
          <Sparkles className="size-3.5 text-blue-500 shrink-0" />
          <span className="text-xs font-medium text-blue-800 flex-1 truncate">
            {safeDisplayText}
          </span>
          <span className="text-[10px] text-blue-400 shrink-0">Proposed</span>
        </div>

        {diffLines.length > 0 && (
          <div className="px-3 py-2 space-y-1.5">
            {diffLines.map((line) => (
              <div key={line.field} className="text-xs">
                <span className="font-medium text-blue-700">
                  {prettyFieldName(line.field)}
                </span>
                {line.type === 'scalar' && (
                  <span className="ml-1.5">
                    {line.old && (
                      <span className="text-red-500 line-through mr-1">
                        {line.old}
                      </span>
                    )}
                    <span className="text-green-700">{line.new}</span>
                  </span>
                )}
                {line.type === 'array' && (
                  <span className="ml-1.5">
                    {line.old && (
                      <span className="text-red-500 mr-1">-{line.old}</span>
                    )}
                    {line.new && (
                      <span className="text-green-700">+{line.new}</span>
                    )}
                  </span>
                )}
                {line.type === 'object' && (
                  <div className="mt-0.5 text-[11px] text-blue-600">
                    {formatEntries(line.new, line.field)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 px-3 py-1.5 border-t border-blue-100">
          <button
            onClick={onApproveProposal}
            className="touch-target px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={onDenyProposal}
            className="touch-target px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    )
  }

  // Denied: gray with strikethrough
  if (status === 'denied') {
    return (
      <div className="max-w-[95%] md:max-w-[80%] flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 text-slate-400">
        <X className="size-3.5 shrink-0 text-red-400" />
        <span className="flex-1 truncate line-through">{safeDisplayText}</span>
        <span className="text-xs text-slate-400 shrink-0">Denied</span>
      </div>
    )
  }

  // Pending / approved / undone: original inline behavior
  return (
    <div
      className={cn(
        'max-w-[95%] md:max-w-[80%] flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs border',
        status === 'pending' && 'border-amber-200 bg-amber-50 text-amber-800',
        status === 'approved' && 'border-green-200 bg-green-50 text-green-700',
        status === 'undone' && 'border-slate-200 bg-slate-50 text-slate-400',
      )}
    >
      <Check
        className={cn(
          'size-3.5 shrink-0',
          status === 'approved' && 'text-green-600',
          status === 'pending' && 'text-amber-500',
          status === 'undone' && 'text-slate-400',
        )}
      />
      <span
        className={cn('flex-1 truncate', status === 'undone' && 'line-through')}
      >
        {safeDisplayText}
      </span>

      {status === 'pending' &&
        (!autoApprove || toolCall.requiresManualApproval) && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onApprove}
              className="touch-target px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={onUndo}
              className="touch-target px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
            >
              Undo
            </button>
          </div>
        )}

      {status === 'undone' && (
        <span className="text-xs text-slate-400 shrink-0">Undone</span>
      )}
    </div>
  )
}
