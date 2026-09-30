/**
 * Live agent timeline (US-4 Task 4.1): renders `AGENT_THOUGHT` and
 * `TOOL_EXECUTION` events chronologically with a clear visual distinction —
 * thoughts as plain speech rows, tool runs as bordered cards carrying a
 * status chip (`started | succeeded | degraded | failed`, US4-AC2/AC3).
 */
import type { JSX } from 'react';
import type { AgentThoughtEvent, ToolExecutionEvent } from '@sentinel/contracts';
import { TOOL_STATUS_BADGE } from '../lib/badgeStyles';

export interface EventTimelineProps {
  readonly events: readonly (AgentThoughtEvent | ToolExecutionEvent)[];
}

function isThoughtEvent(
  event: AgentThoughtEvent | ToolExecutionEvent,
): event is AgentThoughtEvent {
  return event.type === 'AGENT_THOUGHT';
}

export function EventTimeline({ events }: EventTimelineProps): JSX.Element {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
        The agent timeline will appear here as events stream in.
      </p>
    );
  }

  return (
    <ol className="space-y-2" data-testid="event-timeline" aria-label="Agent timeline">
      {events.map((event) =>
        isThoughtEvent(event) ? (
          <li
            key={`${event.id}-${event.timestamp}`}
            data-testid="timeline-thought"
            className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-slate-500">#{event.id}</span>
              <span className="rounded-full bg-sentinel-accent/15 px-2 py-0.5 text-xs font-medium text-sentinel-accent">
                Thought
              </span>
              {event.payload.step !== undefined && (
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {event.payload.step}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-200">{event.payload.content}</p>
          </li>
        ) : (
          <ToolExecutionRow key={`${event.id}-${event.timestamp}`} event={event} />
        ),
      )}
    </ol>
  );
}

function ToolExecutionRow({ event }: { event: ToolExecutionEvent }): JSX.Element {
  const statusBadge = TOOL_STATUS_BADGE[event.payload.status] ?? TOOL_STATUS_BADGE['started'];

  return (
    <li
      data-testid="timeline-tool-execution"
      className="rounded-lg border-l-4 border-l-sentinel-accent border-y border-r border-y-slate-700/60 border-r-slate-700/60 bg-slate-900/60 px-4 py-3"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-slate-500">#{event.id}</span>
        <span className="rounded-full bg-slate-600/30 px-2 py-0.5 text-xs font-medium text-slate-200">
          Tool
        </span>
        <span className="font-mono text-sm text-slate-100">{event.payload.tool}</span>
        <span
          data-testid={`tool-status-${event.payload.status}`}
          className={`rounded border px-2 py-0.5 text-xs font-medium ${statusBadge}`}
        >
          {event.payload.status}
        </span>
      </div>
      {event.payload.output !== undefined && (
        <p className="mt-1 text-sm text-slate-300">{event.payload.output}</p>
      )}
      {event.payload.error !== undefined && (
        <p className="mt-1 text-sm text-sentinel-failed">Error: {event.payload.error}</p>
      )}
    </li>
  );
}
