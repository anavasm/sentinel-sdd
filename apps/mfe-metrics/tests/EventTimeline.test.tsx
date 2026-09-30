/**
 * EventTimeline tests (US-4 Task 4.1): chronological rows, visual distinction
 * between thoughts and tool runs, status chips, and degradation visibility
 * (US4-AC2/AC3).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventTimeline } from '../src/components/EventTimeline';
import { thoughtEvent, toolExecutionEvent } from './mocks/fixtures';

describe('EventTimeline', () => {
  it('shows an empty-state message when no events have arrived', () => {
    render(<EventTimeline events={[]} />);

    expect(screen.getByText(/timeline will appear here/i)).toBeInTheDocument();
  });

  it('renders thoughts with their content and phase step', () => {
    render(<EventTimeline events={[thoughtEvent(1, 'Reading auth module', 'analyze')]} />);

    const row = screen.getByTestId('timeline-thought');
    expect(within(row).getByText('Thought')).toBeInTheDocument();
    expect(within(row).getByText('analyze')).toBeInTheDocument();
    expect(within(row).getByText('Reading auth module')).toBeInTheDocument();
  });

  it('renders tool executions with tool name and status chip', () => {
    render(
      <EventTimeline
        events={[toolExecutionEvent(2, 'succeeded', { output: 'Cloned 42 files (1.2 MB)' })]}
      />,
    );

    const row = screen.getByTestId('timeline-tool-execution');
    expect(within(row).getByText('git-clone')).toBeInTheDocument();
    expect(within(row).getByTestId('tool-status-succeeded')).toHaveTextContent('succeeded');
    expect(within(row).getByText('Cloned 42 files (1.2 MB)')).toBeInTheDocument();
  });

  it('keeps arrival (chronological) order across mixed event types', () => {
    render(
      <EventTimeline
        events={[
          thoughtEvent(1, 'Starting analysis'),
          toolExecutionEvent(2, 'started'),
          thoughtEvent(3, 'Cloning finished'),
          toolExecutionEvent(4, 'degraded', { tool: 'llm-analyze' }),
        ]}
      />,
    );

    const timeline = screen.getByTestId('event-timeline');
    const ids = within(timeline)
      .getAllByText(/^#/)
      .map((idElement) => idElement.textContent);
    expect(ids).toEqual(['#1', '#2', '#3', '#4']);
  });

  it('surfaces LLM degradation with the dedicated degraded chip and detail', () => {
    render(
      <EventTimeline
        events={[
          toolExecutionEvent(1, 'degraded', {
            tool: 'llm-analyze',
            output: 'Provider throttled; falling back to Ollama',
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('tool-status-degraded')).toBeInTheDocument();
    expect(screen.getByText('Provider throttled; falling back to Ollama')).toBeInTheDocument();
  });

  it('shows the error detail for failed tool runs', () => {
    render(
      <EventTimeline
        events={[toolExecutionEvent(1, 'failed', { tool: 'read-file', error: 'Path not found' })]}
      />,
    );

    expect(screen.getByTestId('tool-status-failed')).toBeInTheDocument();
    expect(screen.getByText('Error: Path not found')).toBeInTheDocument();
  });
});
