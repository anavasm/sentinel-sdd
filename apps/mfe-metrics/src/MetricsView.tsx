/**
 * Federated surface of mfe-metrics (exposed as ./MetricsView in vite.config.ts).
 * US-4: live dashboard assembled from the summary header, the agent timeline,
 * and the findings feed, organized in a tab layout (Timeline | Findings |
 * All Events). Stream state still comes from `useAuditStream` (US-3).
 */
import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import type { SentinelAISSEEventContract } from '@sentinel/contracts';
import { useAuditStream } from './hooks/useAuditStream';
import { AuditSummaryHeader } from './components/AuditSummaryHeader';
import { EventTimeline } from './components/EventTimeline';
import { FindingsList } from './components/FindingsList';
import { extractFindings, extractTimelineEvents } from './lib/dashboard';

const TABS = ['Timeline', 'Findings', 'All Events'] as const;
type DashboardTab = (typeof TABS)[number];

function AllEventsPanel({
  events,
}: {
  events: readonly SentinelAISSEEventContract[];
}): JSX.Element {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
        No events received yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1" data-testid="all-events-list" aria-label="All stream events">
      {events.map((event) => (
        <li
          key={`${event.id}-${event.timestamp}`}
          className="rounded border border-slate-700/60 bg-slate-800/50 px-3 py-2 text-sm text-slate-200"
        >
          <span className="mr-2 font-mono text-xs text-slate-400">#{event.id}</span>
          <span className="mr-2 font-medium text-sentinel-accent">{event.type}</span>
          <span className="text-slate-300">{event.timestamp}</span>
        </li>
      ))}
    </ul>
  );
}

export function MetricsView(): JSX.Element {
  const { auditId } = useParams<{ auditId: string }>();
  const { events, status } = useAuditStream(auditId);
  const [selectedTab, setSelectedTab] = useState<DashboardTab>('Timeline');

  const findings = extractFindings(events);
  const timelineEvents = extractTimelineEvents(events);

  return (
    <section aria-label="Audit execution metrics">
      <AuditSummaryHeader auditId={auditId} status={status} events={events} />

      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="mt-4 flex gap-1 rounded-lg border border-slate-700 bg-sentinel-panel p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selectedTab === tab}
            data-testid={`tab-${tab}`}
            onClick={() => setSelectedTab(tab)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              selectedTab === tab
                ? 'bg-sentinel-accent/15 text-sentinel-accent'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {selectedTab === 'Timeline' && (
          <div role="tabpanel" aria-label="Agent timeline panel">
            <EventTimeline events={timelineEvents} />
          </div>
        )}
        {selectedTab === 'Findings' && (
          <div role="tabpanel" aria-label="Findings panel">
            <FindingsList findings={findings} />
          </div>
        )}
        {selectedTab === 'All Events' && (
          <div role="tabpanel" aria-label="All events panel">
            <AllEventsPanel events={events} />
          </div>
        )}
      </div>

      {selectedTab !== 'Findings' && findings.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {findings.length} finding{findings.length === 1 ? '' : 's'} reported so far — see the
          Findings tab.
        </p>
      )}
    </section>
  );
}

// Federation modules are consumed via import() (React.lazy) - a default
// export is required by the host's lazy loader.
export default MetricsView;
